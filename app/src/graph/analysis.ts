// app/src/graph/analysis.ts
import type { Depth, Session } from './state'
import { runPortfolioPipeline, runWatchlistPipeline, type AlertMode } from '../services/portfolio'

export function decideDepth(session: Session, tier?: 'MINOR' | 'MAJOR'): Depth {
  if (tier === 'MAJOR') return 'DEEP'
  if (session === 'SESSION_2') return 'FULL'
  return 'LIGHT'
}

export type AnalysisTarget = { kind: 'tickers'; tickers: string[] } | { kind: 'watchlist' }

/** Run the analysis pipeline for a target. Errors are logged, never thrown to the runner loop. */
export async function runAnalysis(target: AnalysisTarget, depth: Depth, alerts: AlertMode): Promise<void> {
  try {
    if (target.kind === 'watchlist') await runWatchlistPipeline(alerts)
    else await runPortfolioPipeline(target.tickers, depth, alerts)
  } catch (err) {
    console.error('[analysis] pipeline error:', err)
  }
}
