// app/src/graph/orchestrator.ts
// One runner cycle: detect session → refresh prices → check signals → route →
// analyze or skip. A plain sequence of steps over OrchestratorState (it used to be
// a LangGraph graph with no checkpointer and a single branch — framework, no gain).
import type { OrchestratorState, TickerSignal } from './state'
import { detectSession } from './session'
import { detectSignalsForTicker, filterCooledSignals } from './signals'
import { loadPortfolio, getWatchlist, getLatestSnapshots, getSnapshotBefore } from '../db/db'
import { runPriceRefresh } from '../services/portfolio'
import { runAnalysis, decideDepth } from './analysis'

async function detectSessionNode(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const session = detectSession()
  return { current_session: session, last_session: state.current_session, last_check: new Date().toISOString() }
}

async function refreshPricesNode(
  _state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  await runPriceRefresh()
  return {}
}

async function checkSignalsNode(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const portfolio = await loadPortfolio()
  const wl = await getWatchlist()
  const tickers = [...new Set([...Object.keys(portfolio), ...wl.map(w => w.ticker)])]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // One batched query for all latest snapshots, then fan out the per-ticker
  // "week ago" lookups concurrently — avoids the 2N serial round-trips this
  // node used to make every runner cycle.
  const latest = new Map((await getLatestSnapshots()).map(s => [s.ticker, s]))
  const withSnap = tickers.filter(t => latest.has(t))
  const prevSnaps = await Promise.all(withSnap.map(t => getSnapshotBefore(t, weekAgo)))

  const signals: TickerSignal[] = []
  withSnap.forEach((ticker, i) => {
    signals.push(...detectSignalsForTicker(ticker, latest.get(ticker)!, prevSnaps[i]))
  })

  return { signals }
}

function routeNode(
  state: OrchestratorState,
): Partial<OrchestratorState> {
  const { current_session, last_session, signals } = state

  if (current_session === 'CLOSED') {
    return { _route: 'skip' }
  }

  // Only MAJOR signals outside their cooldown window trigger a signal run;
  // cooled signals fall through so the scheduled cadence isn't starved by a
  // stock pinned at a big day move (e.g. ARA) all session.
  const majorSignals = filterCooledSignals(
    signals.filter(s => s.tier === 'MAJOR'),
    state.signal_cooldowns ?? {},
  )
  if (majorSignals.length > 0) {
    const stampedAt = new Date().toISOString()
    const signal_cooldowns = { ...state.signal_cooldowns }
    for (const s of majorSignals) signal_cooldowns[s.ticker] = stampedAt
    return { _route: 'run_analysis', pending_batch: majorSignals.map(s => s.ticker), signal_cooldowns }
  }

  // Fire once at every session boundary (PRE_MARKET→SESSION_1, SESSION_1→LUNCH, etc.)
  if (last_session !== null && last_session !== current_session) {
    console.log(`[orchestrator] session transition ${last_session} → ${current_session}, triggering analysis`)
    return { _route: 'run_analysis', pending_batch: [], last_scheduled: new Date().toISOString() }
  }

  // Check if scheduled run is due (every GRAPH_ANALYSIS_INTERVAL minutes).
  // Deliberately separate from GRAPH_ACTIVE_INTERVAL (runner loop sleep):
  // the loop polls prices/signals often, analysis runs on its own cadence.
  const intervalMin = Number(process.env.GRAPH_ANALYSIS_INTERVAL ?? 30)
  const lastSched = state.last_scheduled ? new Date(state.last_scheduled) : null
  const elapsed = lastSched ? (Date.now() - lastSched.getTime()) / 60_000 : Infinity

  if (elapsed >= intervalMin) {
    return { _route: 'run_analysis', pending_batch: [], last_scheduled: new Date().toISOString() }
  }

  return { _route: 'skip' }
}

async function runAnalysisNode(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  // pending_batch is non-empty only on the signal route; a cooled MAJOR signal
  // may still sit in state.signals during a scheduled run, so batch decides tier.
  const isSpike = state.pending_batch.length > 0
  const depth = decideDepth(state.current_session, isSpike ? 'MAJOR' : 'MINOR')

  // Signal-triggered tickers go to the multi-agent deep-run queue when enabled
  // (drained by graph/worker.ts); anything that fails to enqueue falls back to
  // the inline single-pass so a queue outage never silences a MAJOR signal.
  let inlineBatch = state.pending_batch
  if (isSpike && process.env.DEEP_RUNS_ENABLED === 'true') {
    const { enqueueDeepRun } = await import('../services/deepRun.js')
    const fallback: string[] = []
    for (const ticker of state.pending_batch) {
      try {
        await enqueueDeepRun(ticker)
      } catch (err) {
        console.error(`[orchestrator] deep-run enqueue failed for ${ticker}, falling back inline:`, err)
        fallback.push(ticker)
      }
    }
    if (fallback.length === 0) {
      return { last_run: new Date().toISOString(), signals: [] }
    }
    inlineBatch = fallback
  }

  await runAnalysis(
    // Signal route analyzes the spiking tickers; scheduled and session-boundary
    // runs cover the watchlist (held positions get the runner's daily baseline).
    isSpike ? { kind: 'tickers', tickers: inlineBatch } : { kind: 'watchlist' },
    depth,
    // Telegram alerts are spike-only; scheduled/session-boundary runs stay silent
    isSpike ? 'spike' : 'silent',
  )

  return { last_run: new Date().toISOString(), signals: [] }
}

/** Run one orchestrator cycle and return the next state. */
export async function runCycle(state: OrchestratorState): Promise<OrchestratorState> {
  let next: OrchestratorState = { ...state, ...(await detectSessionNode(state)) }
  next = { ...next, ...(await refreshPricesNode(next)) }
  next = { ...next, ...(await checkSignalsNode(next)) }
  next = { ...next, ...routeNode(next) }
  if (next._route === 'run_analysis') next = { ...next, ...(await runAnalysisNode(next)) }
  return next
}
