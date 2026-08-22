export interface Position {
  ticker: string;
  avg_price: number;
  lots: number;
  active: boolean;
  notes: string | null;
  realized_pnl: number | null;
  updated_at: string | null;
}

export interface Snapshot {
  ticker: string;
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  current_price: number | null;
  prev_close: number | null;
  day_change: number | null;
  day_change_pct: number | null;
  high_52w: number | null;
  low_52w: number | null;
  volume: number | null;
  pe: number | null;
  pb: number | null;
  roe_pct: number | null;
  div_yield_pct: number | null;
  profit_margin_pct: number | null;
  debt_to_equity: number | null;
  beta: number | null;
  eps: number | null;
  market_cap_raw: number | null;
  revenue_raw: number | null;
  fetched_at: string | null;
}

export interface Analysis {
  id?: number;
  ticker: string;
  recommendation: string | null;
  clean_html: string | null;
  raw_output?: string | null;
  model?: string | null;
  analysed_at: string | null;
}

export interface WatchRow {
  id?: number;
  ticker: string;
  kind: "user" | "ai_suggested";
  notes: string | null;
  sector: string | null;
  rationale: string | null;
  added_at: string | null;
}

export interface NewsRow {
  id: number;
  ticker: string | null;
  source: string;
  headline: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  fetched_at?: string | null;
  sentiment_score?: number | null;
  themes?: string | null;
  catalyst?: string | null;
  risk?: string | null;
}

export type GoldPurchase = {
  id: number;
  venue: string;
  grams: number;
  buy_price_per_gram: number;
  purchased_at: string;
  active: boolean;
  side?: "BUY" | "SELL";
  notes: string;
};

export type GoldPrice = {
  venue: string;
  buy_price: number | null;
  sell_price: number | null;
  mid_price: number | null;
  price_at: string | null;
  fetched_at: string;
};

export interface AccuracyRow {
  ticker: string;
  recommendation: string;
  analysed_at: string | null;
  price_at_rec: number | null;
  price_after: number | null;
  actual_change_pct: number | null;
  correct: boolean | null;
}

export type FundCatalogItem = {
  code: string;
  name: string;
  slug: string | null;
  fund_type: string | null;
  category: string | null;
  investment_manager: string | null;
  currency: string;
  active: boolean;
  updated_at: string | null;
};

export type FundPurchase = {
  id: number;
  fund_code: string;
  fund_name: string;
  platform: string;
  currency: string;
  units: number;
  buy_nav_per_unit: number;
  purchased_at: string;
  active: boolean;
  side?: "BUY" | "SELL";
  notes: string;
};

export type FundNav = {
  fund_code: string;
  nav: number | null;
  currency: string;
  nav_at: string | null;
  aum: number | null;
  expense_ratio: number | null;
  cagr: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_ytd: number | null;
  ret_1y: number | null;
  fetched_at: string;
};

export type FundHolding = {
  fund_code: string;
  label: string;
  ticker: string | null;
  percentage: number | null;
  as_of: string;
};

export type ForexRate = {
  id: number;
  base_currency: string;
  quote_currency: string;
  rate: number;
  rate_at: string;
  fetched_at: string;
};

export type BondCouponPayment = {
  id: number;
  bond_holding_id: number;
  amount: number;
  paid_at: string;
  notes: string;
  created_at: string;
};

export type BondHolding = {
  id: number;
  series_type: "SR" | "ORI" | "SBR" | "ST" | "CORP";
  series_code: string;
  platform: string;
  principal: number;
  purchase_price: number | null;
  coupon_rate: number | null;
  maturity_date: string | null;
  purchased_at: string;
  active: boolean;
  notes: string;
};

export type FundProductSummary = {
  fund_code: string;
  fund_name: string;
  fund_type: string | null;
  investment_manager: string | null;
  currency: string;
  total_units: number;
  avg_buy_nav: number;
  total_cost: number;
  latest_nav: number | null;
  nav_at: string | null;
  current_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  realized_pnl: number | null;
  transaction_count: number;
  first_purchased_at: string;
};

export type BondCouponSchedule = {
  id: number;
  bond_holding_id: number;
  series_code: string;
  distribution_date: string;
  status: string | null;
  scraped_at: string;
};

export type BondProductSummary = {
  series_code: string;
  series_type: "SR" | "ORI" | "SBR" | "ST" | "CORP";
  total_principal: number;
  total_purchase_cost: number | null;
  avg_coupon_rate: number | null;
  annual_income: number;
  maturity_date: string | null;
  transaction_count: number;
  first_purchased_at: string;
};

export type WeeklyReview = {
  id: number;
  week_start: string;
  week_end: string;
  report_md: string;
  handover_md: string;
  stats: {
    net_worth?: number;
    net_worth_week_ago?: number | null;
    wow_pct?: number | null;
    combined_pnl?: number;
    total_return?: number;
    rec_total?: number;
    rec_changed?: number;
    accuracy_pct?: number | null;
    accuracy_n?: number;
  } | null;
  model: string | null;
  emailed: boolean;
  created_at: string;
};

export type StockTransaction = {
  id?: number;
  ticker: string;
  side: "BUY" | "SELL";
  lots: number;
  price: number;
  fee?: number;
  txn_at: string;
  notes: string | null;
  created_at?: string;
};

export type StockDividend = {
  id?: number;
  ticker: string;
  amount: number;
  per_share: number | null;
  paid_at: string;
  notes: string | null;
  created_at?: string;
};

export type DividendSchedule = {
  id?: number;
  ticker: string;
  cum_date: string | null;
  ex_date: string;
  recording_date: string | null;
  pay_date: string | null;
  amount_per_share: number | null;
  amount_estimated: boolean;
  currency: string | null;
  source?: string;
  synced_at?: string;
};

export type FundDistribution = {
  id?: number;
  fund_code: string;
  amount: number;
  paid_at: string;
  notes: string | null;
  created_at?: string;
};

export type AccountCharge = {
  id?: number;
  charged_at: string;
  type: "DATA_FEE" | "METERAI" | "LATE_FEE" | "OTHER";
  amount: number;
  notes: string | null;
  created_at?: string;
};
