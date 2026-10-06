// app/src/graph/runner.ts
import 'dotenv/config'
import { runCycle } from './orchestrator'
import { detectSession, isMarketActive } from './session'
import { runPortfolioPipeline } from '../services/portfolio'
import { claimPendingRefresh, claimScheduledRun, hasPendingRefresh, pruneHistory } from '../db/db'
import { syncBondCouponSchedules, sendCouponReminders } from '../services/bonds'
import { syncDividendSchedules, sendDividendReminders } from '../services/dividends'
import { refreshForexRates } from '../services/forex'
import { refreshGoldPrices } from '../services/gold'
import { refreshFundNavs, refreshFundHoldings } from '../services/funds'
import { refreshFundamentals } from '../services/fundamentals'
import { computeValuations, refreshPeers } from '../services/peers'
import { runWeekReview } from '../services/weekReview'
import type { OrchestratorState } from './state'
import { runPendingMigrations } from '../db/migrate'
import { beat } from '../utils/heartbeat'

/** Positive minutes from env, else the default — "" or "5m" must not become a ~1ms busy loop. */
function envMinutes(name: string, def: number): number {
  const v = Number(process.env[name])
  if (process.env[name] != null && !(Number.isFinite(v) && v > 0)) {
    console.warn(`[runner] ${name}="${process.env[name]}" is not a positive number, using ${def}`)
  }
  return (Number.isFinite(v) && v > 0 ? v : def) * 60_000
}

const ACTIVE_INTERVAL_MS  = envMinutes('GRAPH_ACTIVE_INTERVAL', 5)
const IDLE_INTERVAL_MS    = envMinutes('GRAPH_IDLE_INTERVAL', 30)
const BOND_CHECK_HOUR_WIB = 8  // run bond schedule sync at 08:00 WIB daily
const DIVIDEND_CHECK_HOUR_WIB = 8 // dividend sync + reminders at 08:00 WIB daily
const FOREX_CHECK_HOUR_WIB = 9 // run forex refresh at 09:00 WIB daily (market open)
const ASSET_CHECK_HOUR_WIB = 17 // fund NAV refresh at 17:00 WIB daily (NAV final after close)
// Fundamentals sweep at 18:00 WIB: after the 17:00 fund NAV run, so the two
// daily jobs do not collide on the same cycle. A non-numeric override would
// otherwise become NaN and disable the sweep silently and permanently, so fall
// back loudly. Note 0 is a valid hour, which is why this is a finite check and
// not a falsy check.
const rawFundamentalsHour = Number(process.env.FUNDAMENTALS_HOUR_WIB ?? 18)
const FUNDAMENTALS_HOUR_WIB = Number.isFinite(rawFundamentalsHour)
  ? Math.min(23, Math.max(0, rawFundamentalsHour))
  : 18
if (!Number.isFinite(rawFundamentalsHour)) {
  console.warn(`[runner] FUNDAMENTALS_HOUR_WIB="${process.env.FUNDAMENTALS_HOUR_WIB}" is not a number, using 18`)
}
// Gold moves intraday and its venue quotes are not tied to the IDX close, so it
// runs on its own clock rather than riding the daily fund sweep.
const GOLD_INTERVAL_MS = Number(process.env.GOLD_REFRESH_HOURS ?? 3) * 3_600_000
const WEEK_REVIEW_HOUR_WIB = 9  // weekly review Saturday >= 09:00 WIB (after market week closes)
const WEEK_REVIEW_DAY_WIB = 6   // Saturday in WIB
// History retention is a data-deletion policy, so it is opt-in: unset = keep everything.
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) > 0 ? Number(process.env.RETENTION_DAYS) : 0
const RETENTION_HOUR_WIB = 2
const PEERS_HOUR_WIB = 19
const REFRESH_POLL_MS = 30_000  // how often an idle runner checks for dashboard refresh requests

let running = true
let wake = () => {}

// Sleep that SIGTERM cuts short, so shutdown doesn't wait out a 30-minute idle interval.
function sleep(ms: number): Promise<void> {
  return new Promise(r => {
    const t = setTimeout(r, ms)
    wake = () => { clearTimeout(t); r() }
  })
}

process.on('SIGTERM', () => {
  console.log('[runner] SIGTERM received — shutting down after current cycle')
  running = false
  wake()
})

async function runBondDailyChecks(): Promise<void> {
  try {
    console.log('[runner] syncing bond coupon schedules...')
    await syncBondCouponSchedules()
  } catch (err) {
    console.error('[runner] bond sync error:', err)
  }
  try {
    console.log('[runner] checking coupon reminders (H-1)...')
    await sendCouponReminders()
  } catch (err) {
    console.error('[runner] coupon reminder error:', err)
  }
}

async function runDividendDailyChecks(): Promise<void> {
  try {
    console.log('[runner] syncing dividend schedules...')
    await syncDividendSchedules()
  } catch (err) {
    console.error('[runner] dividend sync error:', err)
  }
  try {
    console.log('[runner] checking dividend reminders...')
    await sendDividendReminders()
  } catch (err) {
    console.error('[runner] dividend reminder error:', err)
  }
}

async function runForexDailyRefresh(): Promise<void> {
  try {
    console.log('[runner] refreshing forex rates...')
    await refreshForexRates()
  } catch (err) {
    console.error('[runner] forex refresh error:', err)
  }
}

async function runAssetDailyRefresh(): Promise<void> {
  console.log(`[runner] daily fund refresh starting (due ${ASSET_CHECK_HOUR_WIB}:00 WIB)`)
  try {
    console.log('[runner] refreshing fund NAVs...')
    await refreshFundNavs()
    await refreshFundHoldings()
  } catch (err) {
    console.error('[runner] fund refresh error:', err)
  }
  console.log('[runner] daily fund refresh done')
}

async function runGoldRefresh(reason: string): Promise<void> {
  try {
    console.log(`[runner] refreshing gold prices (${reason})...`)
    await refreshGoldPrices()
  } catch (err) {
    console.error('[runner] gold refresh error:', err)
  }
}

async function main(): Promise<void> {
  beat()
  await runPendingMigrations()
  console.log(`[runner] starting orchestrator (build ${process.env.GIT_COMMIT?.slice(0, 8) ?? 'dev'})`)

  let state: OrchestratorState = {
    current_session: 'CLOSED',
    last_session: null,
    last_check: new Date().toISOString(),
    last_scheduled: null,
    signals: [],
    signal_cooldowns: {},
    pending_batch: [],
    last_run: null,
  }

  // Daily latches: an in-memory fast path, backed by a durable claim in
  // scheduled_runs so a restart (deploy, OOM) never re-runs a job for the day.
  const latched = new Map<string, string>()
  async function due(job: string, todayWib: string): Promise<boolean> {
    if (latched.get(job) === todayWib) return false
    latched.set(job, todayWib)
    try {
      return await claimScheduledRun(job, todayWib)
    } catch (err) {
      latched.delete(job)   // DB unavailable: retry the claim next cycle
      console.error(`[runner] claim ${job} failed:`, err)
      return false
    }
  }
  let lastGoldRefreshMs = 0

  while (running) {
    beat()
    const now = new Date()
    // Shift into WIB once, then read both hour and calendar date off it. Deriving
    // todayWib from now.toISOString() gave the UTC date, which is a day behind
    // between 00:00 and 07:00 WIB - every daily latch below would then double-run
    // or skip for any scheduled hour in that window.
    const wibNow = new Date(now.getTime() + 7 * 3_600_000)
    const wibHour = wibNow.getUTCHours()
    const todayWib = wibNow.toISOString().slice(0, 10)

    // Daily portfolio baseline analysis — first active-session cycle of each
    // market day (~09:00 WIB, live prices). Keeps every held position analyzed
    // at least once per trading day; silent: Telegram alerts
    // are reserved for spike signals.
    if (isMarketActive(detectSession(now)) && await due('portfolio-baseline', todayWib)) {
      try {
        console.log('[runner] running daily portfolio baseline analysis (silent)...')
        await runPortfolioPipeline(undefined, 'FULL', 'silent')
      } catch (err) {
        console.error('[runner] portfolio baseline error:', err)
      }
    }

    // Daily bond schedule sync
    if (wibHour >= BOND_CHECK_HOUR_WIB && await due('bonds', todayWib)) {
      await runBondDailyChecks()
    }

    // Daily dividend schedule sync + reminders
    if (wibHour >= DIVIDEND_CHECK_HOUR_WIB && await due('dividends', todayWib)) {
      await runDividendDailyChecks()
    }

    // Daily forex rate refresh
    if (wibHour >= FOREX_CHECK_HOUR_WIB && await due('forex', todayWib)) {
      await runForexDailyRefresh()
    }

    // Weekly review — Saturday >= 09:00 WIB, once per date
    const wibDay = new Date(now.getTime() + 7 * 3_600_000).getUTCDay()
    if (wibDay === WEEK_REVIEW_DAY_WIB && wibHour >= WEEK_REVIEW_HOUR_WIB && await due('week-review', todayWib)) {
      try {
        console.log('[runner] generating weekly review...')
        await runWeekReview()
      } catch (err) {
        console.error('[runner] weekly review error:', err)
      }
    }

    // Gold on its own cadence: every GOLD_REFRESH_HOURS, independent of the WIB
    // clock, so a restart refreshes immediately and gaps stay bounded.
    if (Date.now() - lastGoldRefreshMs >= GOLD_INTERVAL_MS) {
      lastGoldRefreshMs = Date.now()
      await runGoldRefresh(`every ${GOLD_INTERVAL_MS / 3_600_000}h`)
    }

    // Daily fund NAV refresh (>= so a cycle landing after 17:00 still runs it)
    if (wibHour >= ASSET_CHECK_HOUR_WIB && await due('fund-navs', todayWib)) {
      await runAssetDailyRefresh()
    }

    // Daily fundamentals sweep (>= so a cycle landing after 18:00 still runs it)
    if (wibHour >= FUNDAMENTALS_HOUR_WIB && await due('fundamentals', todayWib)) {
      try {
        console.log('[runner] refreshing fundamentals...')
        const rs = await refreshFundamentals()
        const ok = rs.filter((r) => !r.error).length
        console.log(`[runner] fundamentals refreshed ${ok}/${rs.length}`)
        // Fresh key stats → recompute every holding's 3-way peer valuation.
        console.log(`[runner] valuations computed: ${await computeValuations()}`)
      } catch (err) {
        console.error('[runner] fundamentals refresh error:', err)
      }
    }

    // Weekly peer refresh (IDX classification → peer groups → watchlist `peer` rows →
    // own-history multiples → valuations). Evening, after the 18:00 fundamentals sweep;
    // claimed once per ISO week (key = that week's Monday, WIB).
    const weekKey = new Date(wibNow.getTime() - ((wibNow.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
    if (wibHour >= PEERS_HOUR_WIB && await due('peer-refresh', weekKey)) {
      try {
        console.log('[runner] peer refresh:', await refreshPeers())
      } catch (err) {
        console.error('[runner] peer refresh error:', err)
      }
    }

    // Nightly history thinning (opt-in)
    if (RETENTION_DAYS && wibHour >= RETENTION_HOUR_WIB && await due('retention', todayWib)) {
      try {
        console.log(`[runner] pruned history older than ${RETENTION_DAYS}d:`, await pruneHistory(RETENTION_DAYS))
      } catch (err) {
        console.error('[runner] retention error:', err)
      }
    }

    try {
      // Check for manual refresh triggers from DB (one queue, routed by kind)
      const pending = await claimPendingRefresh('stock')
      if (pending) {
        console.log('[runner] claimed pending stock refresh')
      }

      if (await claimPendingRefresh('gold')) {
        console.log('[runner] claimed pending gold refresh')
        lastGoldRefreshMs = Date.now()
        await runGoldRefresh('manual')
      }

      if (await claimPendingRefresh('fund')) {
        console.log('[runner] claimed pending fund refresh')
        try {
          await refreshFundNavs()
          await refreshFundHoldings()
          await refreshForexRates()
        } catch (err) {
          console.error('[runner] fund refresh error:', err)
        }
      }

      state = await runCycle(state)
      console.log(`[runner] cycle done — session: ${state.current_session}, signals: ${state.signals?.length ?? 0}`)
    } catch (err) {
      console.error('[runner] cycle error:', err)
    }

    const isActive = ['SESSION_1', 'SESSION_2'].includes(state.current_session)
    const interval = isActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
    // Sleep in short slices so a refresh pressed on the dashboard is picked up
    // within ~30s instead of after a full (up to 30 min) idle interval.
    const wakeAt = Date.now() + interval
    while (running && Date.now() < wakeAt) {
      beat()
      await sleep(Math.min(REFRESH_POLL_MS, wakeAt - Date.now()))
      if (running && await hasPendingRefresh().catch(() => false)) break
    }
  }

  console.log('[runner] stopped')
}

main().catch((err) => {
  console.error('[runner] fatal:', err)
  process.exit(1)
})
