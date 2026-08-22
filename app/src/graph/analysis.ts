// app/src/graph/analysis.ts
import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import type { Depth, Session, AnalysisState } from './state'
import { runPortfolioPipeline, runWatchlistPipeline, type AlertMode } from '../services/portfolio'

export function decideDepth(session: Session, tier?: 'MINOR' | 'MAJOR'): Depth {
  if (tier === 'MAJOR') return 'DEEP'
  if (session === 'SESSION_2') return 'FULL'
  return 'LIGHT'
}

const AnalysisAnnotation = Annotation.Root({
  tickers:  Annotation<string[]>,
  depth:    Annotation<Depth>,
  session:  Annotation<Session>,
  alerts:   Annotation<AlertMode>,
  results:  Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }) }),
  errors:   Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }) }),
})

type AnalysisAnnotationType = typeof AnalysisAnnotation.State

async function runAnalysis(state: AnalysisAnnotationType): Promise<Partial<AnalysisAnnotationType>> {
  const isWatchlist = state.tickers.length === 0
  try {
    if (isWatchlist) {
      await runWatchlistPipeline(state.alerts)
    } else {
      await runPortfolioPipeline(state.tickers, state.depth, state.alerts)
    }
  } catch (err) {
    console.error('[analysis] pipeline error:', err)
  }
  return {}
}

export function buildAnalysisGraph() {
  const graph = new StateGraph(AnalysisAnnotation)
    .addNode('run_analysis', runAnalysis)
    .addEdge(START, 'run_analysis')
    .addEdge('run_analysis', END)
  return graph.compile()
}

// Re-export type alias for callers that pass AnalysisState to graph.invoke()
export type { AnalysisState }
