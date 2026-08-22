// app/src/graph/state.ts
export type Session = 'CLOSED' | 'PRE_MARKET' | 'SESSION_1' | 'LUNCH' | 'SESSION_2' | 'AFTER_HOURS'
export type SignalType = 'PRICE_MOVE' | 'VOLUME_SPIKE' | 'COMBINED'
export type SignalTier = 'MINOR' | 'MAJOR'
export type Depth = 'LIGHT' | 'FULL' | 'DEEP'

export interface TickerSignal {
  ticker: string
  signal_type: SignalType
  tier: SignalTier
  value: number
  detected_at: string
}

export interface OrchestratorState {
  current_session: Session
  last_session: Session | null
  last_check: string
  last_scheduled: string | null
  signals: TickerSignal[]
  signal_cooldowns: Record<string, string>
  pending_batch: string[]
  last_run: string | null
  last_news_fetch: string | null
  _route?: string
}

export interface AnalysisState {
  tickers: string[]
  depth: Depth
  session: Session
  alerts: 'spike' | 'dedup' | 'silent'
  results: Record<string, string>
  errors: Record<string, string>
}
