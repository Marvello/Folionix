// Stock snapshot row (mirrors stock_snapshots table columns)
export interface StockSnapshotRow {
  id?: number
  fetched_at?: string
  ticker: string
  symbol?: string | null
  name?: string | null
  sector?: string | null
  industry?: string | null
  current_price: number | null
  prev_close?: number | null
  day_change: number | null
  day_change_pct: number | null
  high_52w: number | null
  low_52w: number | null
  volume: number | null
  avg_price: number
  lots: number
  unrealized_pnl: number | null
  unrealized_pnl_pct: number | null
  total_pnl: number | null
  position_status?: string | null
  dist_from_high?: number | null
  dist_from_low?: number | null
  pe: number | null
  pb: number | null
  roe_pct?: number | null
  div_yield_pct: number | null
  profit_margin_pct?: number | null
  debt_to_equity?: number | null
  beta?: number | null
  eps?: number | null
  market_cap_raw: number | null
  revenue_raw?: number | null
}

// Portfolio position row (mirrors portfolio_positions table)
export interface PositionRow {
  id?: number
  ticker: string
  avg_price: number
  lots: number
  notes: string | null
  active: boolean
  realized_pnl?: number
  updated_at?: string
}

// Gold purchase row (mirrors gold_purchases table)
export interface GoldPurchaseRow {
  id?: number
  venue: string
  grams: number
  buy_price_per_gram: number
  notes: string | null
  purchased_at: string
  active: boolean
  side?: 'BUY' | 'SELL'
  updated_at?: string
}

// Gold price snapshot (mirrors gold_snapshots table)
export interface GoldSnapshotRow {
  id?: number
  venue: string
  buy_price?: number | null
  sell_price?: number | null
  mid_price?: number | null
  price_at?: string | null
  fetched_at?: string
}

// Mutual fund purchase (mirrors fund_purchases table)
export interface FundPurchaseRow {
  id?: number
  fund_code: string
  units: number
  buy_nav_per_unit: number
  notes: string | null
  purchased_at: string
  active: boolean
  side?: 'BUY' | 'SELL'
  currency?: string
  fund_name?: string
  platform?: string
  updated_at?: string
}

// Mutual fund catalog entry (mirrors fund_catalog table)
export interface FundCatalogRow {
  code: string
  name: string
  slug?: string | null
  fund_type?: string | null
  category?: string | null
  investment_manager?: string | null
  currency?: string
  active?: boolean
  updated_at?: string
}

// Fund NAV snapshot (mirrors fund_snapshots table)
export interface FundSnapshotRow {
  id?: number
  fund_code: string
  nav: number
  nav_at: string
  aum?: number | null
  expense_ratio?: number | null
  cagr?: number | null
  ret_1m?: number | null
  ret_3m?: number | null
  ret_ytd?: number | null
  ret_1y?: number | null
  fetched_at?: string
}

// Fund portfolio composition (mirrors fund_holdings table)
export interface FundHoldingRow {
  fund_code: string
  label: string
  ticker?: string | null
  percentage?: number | null
  as_of: string
}

// Bond holding (mirrors bond_holdings table)
export interface BondHoldingRow {
  id?: number
  series_code: string
  series_type: string
  principal: number
  coupon_rate: number
  maturity_date: string
  notes: string | null
  active: boolean
  platform?: string
  purchase_price?: number | null
  purchased_at?: string
  updated_at?: string
}

// Bond coupon schedule entry (mirrors bond_coupon_schedule table)
export interface BondCouponScheduleRow {
  id?: number
  bond_holding_id: number
  series_code: string
  distribution_date: string
  status: string | null
  scraped_at?: string
}

// Bond coupon payment record (mirrors bond_coupon_payments table)
export interface BondCouponPaymentRow {
  id?: number
  bond_id: number
  paid_at: string
  amount: number
  notes: string | null
}

// Watchlist entry (mirrors watchlist table)
export interface WatchlistRow {
  id?: number
  ticker: string
  notes: string | null
  kind: 'user' | 'ai_suggested'
  added_at?: string
}

// LLM analysis row (mirrors llm_analyses table)
export interface LlmAnalysisRow {
  id?: number
  snapshot_id: number
  ticker: string
  model?: string | null
  raw_output?: string | null
  clean_html?: string | null
  recommendation?: string | null
  sent_telegram: boolean
  skipped_same: boolean
  analysed_at?: string
}

// News sentiment row (mirrors news_sentiments table; raw_output omitted)
export interface NewsSentimentRow {
  id?: number
  ticker: string
  summarized_at: string
  depth: string
  score: number
  themes?: string | null
  catalyst?: string | null
  risk?: string | null
}

// Stock transaction row (mirrors stock_transactions table)
export interface StockTransactionRow {
  id?: number
  ticker: string
  side: 'BUY' | 'SELL'
  lots: number
  price: number
  fee?: number
  txn_at: string
  notes?: string | null
  created_at?: string
}

// Stock dividend row (mirrors stock_dividends table)
export interface StockDividendRow {
  id?: number
  ticker: string
  amount: number
  per_share?: number | null
  paid_at: string
  notes?: string | null
  created_at?: string
}

// Fund distribution row (mirrors fund_distributions table)
export interface FundDistributionRow {
  id?: number
  fund_code: string
  amount: number
  paid_at: string
  notes?: string | null
  created_at?: string
}

// Account charge row (mirrors account_charges table) — costs not tied to a holding
export interface AccountChargeRow {
  id?: number
  charged_at: string
  type: 'DATA_FEE' | 'METERAI' | 'LATE_FEE' | 'OTHER'
  amount: number
  notes?: string | null
  created_at?: string
}

// Weekly review row (mirrors weekly_reviews table)
export interface WeeklyReviewRow {
  id?: number
  week_start: string
  week_end: string
  report_md: string
  handover_md: string
  stats?: Record<string, unknown> | null
  model?: string | null
  emailed?: boolean
  created_at?: string
}

// One row of the recommendation_accuracy() RPC result
export interface RecommendationAccuracyRow {
  ticker: string
  recommendation: string
  analysed_at: string | null
  price_at_rec: number | null
  price_after: number | null
  days_after: number
  actual_change_pct: number | null
  correct: boolean | null
}

// Dividend schedule row (mirrors dividend_schedule table)
export interface DividendScheduleRow {
  id: number
  ticker: string
  cum_date: string | null
  ex_date: string
  recording_date: string | null
  pay_date: string | null
  amount_per_share: number | null
  amount_estimated: boolean
  currency: string | null
  source: string
  synced_at: string
}

// Analysis job row (mirrors analysis_jobs table — multi-agent deep-run queue)
export interface AnalysisJobRow {
  id?: number
  ticker: string
  kind: 'persona' | 'consensus'
  persona?: string | null
  run_id: string
  status?: 'pending' | 'running' | 'done' | 'error'
  priority?: number
  payload?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  attempts?: number
  error?: string | null
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
}

// Persona analysis row (mirrors persona_analyses table)
export interface PersonaAnalysisRow {
  id?: number
  run_id: string
  snapshot_id?: number | null
  ticker: string
  persona: string
  signal: 'bullish' | 'neutral' | 'bearish'
  confidence: number
  reasoning?: string | null
  model?: string | null
  analysed_at?: string
}
