// app/src/graph/runner.ts
import 'dotenv/config'
import { buildOrchestratorGraph } from './orchestrator'
import { detectSession, isMarketActive } from './session'
import { runPortfolioPipeline } from '../services/portfolio'
import { claimPendingRefresh } from '../db/db'
import { syncBondCouponSchedules, sendCouponReminders } from '../services/bonds'
import { syncDividendSchedules, sendDividendReminders } from '../services/dividends'
import { refreshForexRates } from '../services/forex'
import { refreshGoldPrices } from '../services/gold'
import { refreshFundNavs, refreshFundHoldings } from '../services/funds'
import { runWeekReview } from '../services/weekReview'
import type { OrchestratorState } from './state'

const ACTIVE_INTERVAL_MS  = Number(process.env.GRAPH_ACTIVE_INTERVAL ?? 5) * 60_000
const IDLE_INTERVAL_MS    = Number(process.env.GRAPH_IDLE_INTERVAL ?? 30) * 60_000
const BOND_CHECK_HOUR_WIB = 8  // run bond schedule sync at 08:00 WIB daily
const DIVIDEND_CHECK_HOUR_WIB = 8 // dividend sync + reminders at 08:00 WIB daily
const FOREX_CHECK_HOUR_WIB = 9 // run forex refresh at 09:00 WIB daily (market open)
const ASSET_CHECK_HOUR_WIB = 17 // fund NAV refresh at 17:00 WIB daily (NAV final after close)
// Gold moves intraday and its venue quotes are not tied to the IDX close, so it
// runs on its own clock rather than riding the daily fund sweep.
const GOLD_INTERVAL_MS = Number(process.env.GOLD_REFRESH_HOURS ?? 3) * 3_600_000
const WEEK_REVIEW_HOUR_WIB = 9  // weekly review Saturday >= 09:00 WIB (after market week closes)
const WEEK_REVIEW_DAY_WIB = 6   // Saturday in WIB

let running = true

process.on('SIGTERM', () => {
  console.log('[runner] SIGTERM received — shutting down after current cycle')
  running = false
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
  console.log('[runner] starting LangGraph orchestrator')
  const graph = buildOrchestratorGraph()

  let state: OrchestratorState = {
    current_session: 'CLOSED',
    last_session: null,
    last_check: new Date().toISOString(),
    last_scheduled: null,
    signals: [],
    signal_cooldowns: {},
    pending_batch: [],
    last_run: null,
    last_news_fetch: null,
  }

  // Initial price refresh on startup
  try {
    await claimPendingRefresh()
  } catch { /* ignore */ }

  let lastPortfolioBaselineDate = ''
  let lastBondCheckDate = ''
  let lastDividendCheckDate = ''
  let lastForexCheckDate = ''
  let lastAssetCheckDate = ''
  let lastGoldRefreshMs = 0
  let lastWeekReviewDate = ''

  while (running) {
    const now = new Date()
    const wibHour = (now.getUTCHours() + 7) % 24
    const todayWib = now.toISOString().slice(0, 10)

    // Daily portfolio baseline analysis — first active-session cycle of each
    // market day (~09:00 WIB, live prices). Keeps every held position analyzed
    // at least once per trading day; silent: Telegram alerts
    // are reserved for spike signals.
    if (isMarketActive(detectSession(now)) && lastPortfolioBaselineDate !== todayWib) {
      lastPortfolioBaselineDate = todayWib
      try {
        console.log('[runner] running daily portfolio baseline analysis (silent)...')
        await runPortfolioPipeline(undefined, 'FULL', 'silent')
      } catch (err) {
        console.error('[runner] portfolio baseline error:', err)
      }
    }

    // Daily bond schedule sync
    if (wibHour >= BOND_CHECK_HOUR_WIB && lastBondCheckDate !== todayWib) {
      lastBondCheckDate = todayWib
      await runBondDailyChecks()
    }

    // Daily dividend schedule sync + reminders
    if (wibHour >= DIVIDEND_CHECK_HOUR_WIB && lastDividendCheckDate !== todayWib) {
      lastDividendCheckDate = todayWib
      await runDividendDailyChecks()
    }

    // Daily forex rate refresh
    if (wibHour >= FOREX_CHECK_HOUR_WIB && lastForexCheckDate !== todayWib) {
      lastForexCheckDate = todayWib
      await runForexDailyRefresh()
    }

    // Weekly review — Saturday >= 09:00 WIB, once per date
    const wibDay = new Date(now.getTime() + 7 * 3_600_000).getUTCDay()
    if (wibDay === WEEK_REVIEW_DAY_WIB && wibHour >= WEEK_REVIEW_HOUR_WIB && lastWeekReviewDate !== todayWib) {
      lastWeekReviewDate = todayWib
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
    if (wibHour >= ASSET_CHECK_HOUR_WIB && lastAssetCheckDate !== todayWib) {
      lastAssetCheckDate = todayWib
      await runAssetDailyRefresh()
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

      state = await graph.invoke(state) as OrchestratorState
      console.log(`[runner] cycle done — session: ${state.current_session}, signals: ${state.signals?.length ?? 0}`)
    } catch (err) {
      console.error('[runner] cycle error:', err)
    }

    const isActive = ['SESSION_1', 'SESSION_2'].includes(state.current_session)
    const interval = isActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
    await new Promise(r => setTimeout(r, interval))
  }

  console.log('[runner] stopped')
}

main().catch(console.error)
