// app/src/graph/orchestrator.ts
import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import type { OrchestratorState, Session, TickerSignal } from './state'
import { detectSession } from './session'
import { detectSignalsForTicker, filterCooledSignals } from './signals'
import { loadPortfolio, getWatchlist, getLatestSnapshots, getSnapshotBefore } from '../db/db'
import { runPriceRefresh } from '../services/portfolio'
import { buildAnalysisGraph, decideDepth } from './analysis'

const OrchestratorAnnotation = Annotation.Root({
  current_session: Annotation<Session>,
  last_session:    Annotation<Session | null>,
  last_check:      Annotation<string>,
  last_scheduled:  Annotation<string | null>,
  signals:         Annotation<TickerSignal[]>,
  signal_cooldowns: Annotation<Record<string, string>>,
  pending_batch:   Annotation<string[]>,
  last_run:        Annotation<string | null>,
  last_news_fetch: Annotation<string | null>,
  _route:          Annotation<string | undefined>,
})

type OrchestratorAnnotationType = typeof OrchestratorAnnotation.State

async function detectSessionNode(
  state: OrchestratorAnnotationType,
): Promise<Partial<OrchestratorAnnotationType>> {
  const session = detectSession()
  return { current_session: session, last_session: state.current_session, last_check: new Date().toISOString() }
}

async function refreshPricesNode(
  _state: OrchestratorAnnotationType,
): Promise<Partial<OrchestratorAnnotationType>> {
  await runPriceRefresh()
  return {}
}

async function fetchNewsNode(
  _state: OrchestratorAnnotationType,
): Promise<Partial<OrchestratorAnnotationType>> {
  return { last_news_fetch: new Date().toISOString() }
}

async function checkSignalsNode(
  state: OrchestratorAnnotationType,
): Promise<Partial<OrchestratorAnnotationType>> {
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
  state: OrchestratorAnnotationType,
): Partial<OrchestratorAnnotationType> {
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
  state: OrchestratorAnnotationType,
): Promise<Partial<OrchestratorAnnotationType>> {
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

  const graph = buildAnalysisGraph()
  await graph.invoke({
    tickers: inlineBatch,
    depth,
    session: state.current_session,
    // Telegram alerts are spike-only; scheduled/session-boundary runs stay silent
    alerts: isSpike ? 'spike' as const : 'silent' as const,
    results: {},
    errors: {},
  })

  return { last_run: new Date().toISOString(), signals: [] }
}

async function skipNode(
  _state: OrchestratorAnnotationType,
): Promise<Partial<OrchestratorAnnotationType>> {
  return {}
}

function routeDecision(state: OrchestratorAnnotationType): string {
  return state._route ?? 'skip'
}

export function buildOrchestratorGraph() {
  const graph = new StateGraph(OrchestratorAnnotation)
    .addNode('detect_session',  detectSessionNode)
    .addNode('refresh_prices',  refreshPricesNode)
    .addNode('fetch_news',      fetchNewsNode)
    .addNode('check_signals',   checkSignalsNode)
    .addNode('route',           (s: OrchestratorAnnotationType) => ({ ...routeNode(s) }))
    .addNode('run_analysis',    runAnalysisNode)
    .addNode('skip',            skipNode)
    .addEdge(START, 'detect_session')
    .addEdge('detect_session', 'refresh_prices')
    .addEdge('refresh_prices', 'fetch_news')
    .addEdge('fetch_news', 'check_signals')
    .addEdge('check_signals', 'route')
    .addConditionalEdges('route', routeDecision, {
      run_analysis: 'run_analysis',
      skip: 'skip',
    })
    .addEdge('run_analysis', END)
    .addEdge('skip', END)

  return graph.compile()
}

// Re-export for runner.ts compatibility
export type { OrchestratorState }
