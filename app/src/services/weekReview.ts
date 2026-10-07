import 'dotenv/config'
import { aggregatePortfolio, type AggregateInput, type PortfolioAggregate } from '../../../lib/aggregate'
import { estimateCouponNet, inferPaymentsPerYear, latestPaymentByHolding } from '../../../lib/coupon'
import { displayTicker, fmtIdr, wibDateOffset, WIB } from '../../../lib/format'
import type {
  AccountChargeRow, BondHoldingRow, DividendScheduleRow, FundDistributionRow, FundPurchaseRow, GoldPurchaseRow,
  LlmAnalysisRow, NewsSentimentRow, RecommendationAccuracyRow, StockDividendRow, StockSnapshotRow, StockTransactionRow,
} from '../../../lib/types'
import {
  getAllPositions, getLatestSnapshots, getSnapshotBefore,
  getGoldPurchases, getLatestGoldPrices, getGoldPriceBefore,
  getBondHoldings, getBondCouponPayments,
  getFundPurchases, getLatestFundNavs, getFundNavBefore,
  getForexRatesToIdr, getStockDividends, getFundDistributions, getAccountCharges,
  getAnalysesBetween, getRecommendationAccuracy, getSentimentsBetween, getSnapshotPricesSince,
  getStockTransactions, getBondCouponPaymentRows, getBondCouponScheduleDates, getDividendScheduleBetween,
  saveWeeklyReview, markWeeklyReviewEmailed,
} from '../db/db'
import { callLlm } from '../ai/llm'
import { sendTelegram } from '../telegram/client'
import { sendEmailMarkdown } from './email'

// ── TYPES ───────────────────────────────────────────────────────────────────

export interface StockWeekChange {
  ticker: string
  priceNow: number | null
  priceWeekAgo: number | null
  changePct: number | null
}

export interface RecLedgerEntry {
  ticker: string
  recommendation: string
  analysedAt: string
  model: string | null
  priceAtRec: number | null
  priceNow: number | null
  changeSincePct: number | null
}

/** Which review inputs failed to load, so the report can say so explicitly. */
export interface LedgerFailures {
  ledger?: boolean
  accuracy?: boolean
}

export interface WeekReviewStats {
  net_worth: number
  net_worth_week_ago: number | null
  wow_pct: number | null
  combined_pnl: number
  total_return: number
  rec_total: number
  rec_changed: number
  accuracy_pct: number | null
  accuracy_n: number
  [key: string]: unknown
}

export interface WeekReviewResult {
  id: number
  weekStart: string
  weekEnd: string
  reportMd: string
  handoverMd: string
  stats: WeekReviewStats
}

/** Retry a transient DB read a few times before giving up (250ms backoff). */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      console.error(`[weekReview] ${label} attempt ${i}/${attempts} failed:`, err instanceof Error ? err.message : err)
      if (i < attempts) await new Promise(r => setTimeout(r, 250 * i))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`)
}

/** Latest price at/before `at` from a per-ticker ascending price series. */
export function priceAt(series: Array<{ current_price: number | null; fetched_at: string }> | undefined, at: Date): number | null {
  if (!series) return null
  const cutoff = at.getTime()
  let price: number | null = null
  for (const p of series) {
    if (new Date(p.fetched_at).getTime() > cutoff) break
    if (p.current_price != null) price = p.current_price
  }
  return price
}

// ── MARKDOWN BUILDERS (pure, unit-tested) ───────────────────────────────────

const pct = (n: number | null): string => (n == null ? 'N/A' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)
const idr = (n: number | null): string => (n == null ? 'N/A' : fmtIdr(n))

export function buildNumbersSection(
  current: PortfolioAggregate,
  weekAgo: PortfolioAggregate | null,
  stockChanges: StockWeekChange[],
  assetMoves: AssetMove[] = [],
): string {
  const wow = (now: number, before: number | null | undefined): string => {
    if (before == null || before === 0) return 'N/A'
    return pct(((now - before) / Math.abs(before)) * 100)
  }
  const lines = [
    '## Portfolio This Week',
    '',
    '| Metric | Now | Week Ago | WoW |',
    '|---|---:|---:|---:|',
    `| Net Worth | ${idr(current.netWorth)} | ${idr(weekAgo?.netWorth ?? null)} | ${wow(current.netWorth, weekAgo?.netWorth)} |`,
    `| Unrealized P&L | ${idr(current.combinedPnl)} | ${idr(weekAgo?.combinedPnl ?? null)} | ${wow(current.combinedPnl, weekAgo?.combinedPnl)} |`,
    `| Total Return | ${idr(current.totalReturn)} | ${idr(weekAgo?.totalReturn ?? null)} | ${wow(current.totalReturn, weekAgo?.totalReturn)} |`,
    '',
    '| Product | Value | P&L | Income |',
    '|---|---:|---:|---:|',
    ...current.products.map(p => `| ${p.name} | ${idr(p.value)} | ${idr(p.pnl)} | ${idr(p.income)} |`),
    '',
  ]
  if (stockChanges.length > 0) {
    lines.push('### Stocks — week change', '', '| Ticker | Now | Week Ago | Change |', '|---|---:|---:|---:|')
    const sorted = [...stockChanges].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity))
    for (const s of sorted) {
      lines.push(`| ${displayTicker(s.ticker)} | ${idr(s.priceNow)} | ${idr(s.priceWeekAgo)} | ${pct(s.changePct)} |`)
    }
    lines.push('')
  }
  if (assetMoves.length > 0) {
    lines.push('### Gold & Funds — week change', '', '| Asset | Kind | Unit | Now | Week Ago | Change |', '|---|---|---|---:|---:|---:|')
    for (const m of assetMoves) {
      const change = m.now != null && m.weekAgo ? ((m.now - m.weekAgo) / m.weekAgo) * 100 : null
      lines.push(`| ${m.name} | ${m.kind} | ${m.unit} | ${num(m.now)} | ${num(m.weekAgo)} | ${pct(change)} |`)
    }
    lines.push('')
  }
  lines.push('_Week-ago figures reprice current holdings at week-ago prices; buys/sells during the week are not backed out._', '')
  return lines.join('\n')
}

const ACCURACY_CLASSES = ['BUY-ISH', 'SELL-ISH', 'HOLD-ISH'] as const

export function buildLedgerSection(
  ledger: RecLedgerEntry[],
  accuracy: RecommendationAccuracyRow[],
  failures: LedgerFailures = {},
): string {
  const lines = ['## AI Recommendations This Week', '']
  if (ledger.length === 0) {
    // An empty ledger after a failed fetch is not evidence of an idle week —
    // saying so would feed the self-critique a false premise.
    lines.push(failures.ledger
      ? '_⚠️ Recommendation ledger unavailable — the fetch failed. Treat this section as missing data, not as an idle week._'
      : '_No new recommendations were issued this week._', '')
  } else {
    lines.push('| Ticker | Recommendation | When | Price at Rec | Price Now | Since |', '|---|---|---|---:|---:|---:|')
    // newest first
    const rows = [...ledger].sort((a, b) => b.analysedAt.localeCompare(a.analysedAt))
    for (const e of rows) {
      lines.push(`| ${displayTicker(e.ticker)} | ${e.recommendation} | ${e.analysedAt.slice(0, 16).replace('T', ' ')} | ${idr(e.priceAtRec)} | ${idr(e.priceNow)} | ${pct(e.changeSincePct)} |`)
    }
    lines.push('')
  }
  const scored = accuracy.filter(a => a.correct != null)
  if (scored.length > 0) {
    const hits = scored.filter(a => a.correct).length
    lines.push(
      `**Recommendation accuracy** (last ${scored.length} scored recs, price ${accuracy[0]?.days_after ?? 3} days after): ` +
      `${hits}/${scored.length} correct (${((hits / scored.length) * 100).toFixed(0)}%).`,
      '',
      // The blended number is dominated by whichever class is most numerous,
      // and HOLD-ish outnumbers everything. Split it so a desk that is 92% right
      // about doing nothing and 33% right about acting cannot report one figure.
      '| Class | Scored | Correct | Rate |',
      '|---|---:|---:|---:|',
      ...ACCURACY_CLASSES.map(cls => {
        const rows = scored.filter(a => a.rec_class === cls)
        const ok = rows.filter(a => a.correct).length
        return `| ${cls} | ${rows.length} | ${ok} | ${rows.length === 0 ? '—' : `${((ok / rows.length) * 100).toFixed(0)}%`} |`
      }),
      '',
    )
  } else if (failures.accuracy) {
    lines.push('_⚠️ Recommendation accuracy unavailable — the scoring query failed._', '')
  }
  return lines.join('\n')
}

export function buildNewsSection(sentiments: NewsSentimentRow[]): string {
  const lines = ['## News Sentiment This Week', '']
  if (sentiments.length === 0) {
    lines.push('_No news sentiment recorded this week._', '')
    return lines.join('\n')
  }
  const clip = (s: string | null | undefined): string =>
    !s ? '—' : s.length > 120 ? `${s.slice(0, 117)}…` : s
  const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`
  // sentiments arrive newest-first; group per ticker
  const byTicker = new Map<string, NewsSentimentRow[]>()
  for (const s of sentiments) {
    const key = s.ticker.toUpperCase()
    const arr = byTicker.get(key)
    if (arr) arr.push(s)
    else byTicker.set(key, [s])
  }
  lines.push('| Ticker | Score | Trend | Themes | Catalyst | Risk |', '|---|---:|---|---|---|---|')
  for (const [, rows] of byTicker) {
    const latest = rows[0]
    const avg = rows.reduce((sum, r) => sum + r.score, 0) / rows.length
    const trend = rows.length === 1 ? 'single read' : `avg ${avg >= 0 ? '+' : ''}${avg.toFixed(1)} over ${rows.length} reads`
    lines.push(
      `| ${displayTicker(latest.ticker)} | ${signed(latest.score)} | ${trend} | ${clip(latest.themes)} | ${clip(latest.catalyst)} | ${clip(latest.risk)} |`,
    )
  }
  lines.push('', '_Score scale: −5 (bearish) … +5 (bullish); latest read shown, trend over the week._', '')
  return lines.join('\n')
}

// ── WHOLE-PORTFOLIO SECTIONS (allocation, activity, coming up) ──────────────

export interface HoldingValue {
  kind: 'Stock' | 'Gold' | 'Fund' | 'Bond'
  name: string
  value: number
  /** Government series (SR/ORI/SBR/ST): no single-issuer risk, so never flagged. */
  sovereign?: boolean
}

/** Per-unit price of a non-stock asset now vs a week ago (gold per gram, fund NAV per unit). */
export interface AssetMove {
  kind: 'Gold' | 'Fund'
  name: string
  unit: string
  now: number | null
  weekAgo: number | null
}

export interface ActivityRow {
  date: string
  kind: string
  name: string
  detail: string
  amount: number | null
  side?: 'BUY' | 'SELL'
}

export interface WeekActivity {
  trades: ActivityRow[]
  income: ActivityRow[]
  fees: ActivityRow[]
}

export interface UpcomingEvent {
  date: string
  event: 'Ex-dividend' | 'Dividend pay' | 'Coupon' | 'Maturity'
  name: string
  detail: string
}

/** Flag a single holding (except sovereign bonds) above this share of net worth. */
export const CONCENTRATION_HOLDING_PCT = 20
/** Flag a single asset class above this share of net worth. */
export const CONCENTRATION_CLASS_PCT = 60
/** Look-ahead for dividend dates and coupons. */
export const UPCOMING_DAYS = 14
/** Look-ahead for bond maturities (reinvestment needs more lead time). */
export const MATURITY_DAYS = 90

const emptyAggInput = (fxToIdr: Map<string, number>): AggregateInput => ({
  positions: [], snapshots: [], goldPurchases: [], goldPrices: [],
  bonds: [], bondPayments: [], fundPurchases: [], fundNavs: [],
  fxToIdr, stockDividends: [], fundDistributions: [], accountCharges: [],
})

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = out.get(k)
    if (arr) arr.push(r)
    else out.set(k, [r])
  }
  return out
}

const num = (n: number | null): string =>
  (n == null ? 'N/A' : n.toLocaleString('id-ID', { maximumFractionDigits: 4 }))
const share = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null)
const pct1 = (n: number | null): string => (n == null ? 'N/A' : `${n.toFixed(1)}%`)

/** WIB calendar day of a date column (passed through) or a timestamptz (converted). */
export function wibDay(at: string): string {
  return at.length === 10 ? at : new Date(at).toLocaleDateString('en-CA', { timeZone: WIB })
}

/**
 * Market value per holding. Each value comes from `aggregatePortfolio` run on
 * that holding's rows alone, so gold/fund netting and fx stay in one place.
 */
export function holdingValues(
  input: AggregateInput,
  opts: { fundNames?: Map<string, string>; bonds?: Array<{ series_code: string; series_type: string; principal: number }> } = {},
): HoldingValue[] {
  const base = emptyAggInput(input.fxToIdr)
  const out: HoldingValue[] = []
  for (const p of input.positions) {
    if (!p.lots || p.lots <= 0) continue
    const value = aggregatePortfolio({ ...base, positions: [p], snapshots: input.snapshots }).stockValue
    out.push({ kind: 'Stock', name: displayTicker(p.ticker), value })
  }
  for (const [venue, rows] of groupBy(input.goldPurchases, g => g.venue)) {
    const value = aggregatePortfolio({ ...base, goldPurchases: rows, goldPrices: input.goldPrices }).goldValue
    if (value > 0) out.push({ kind: 'Gold', name: venue, value })
  }
  for (const [code, rows] of groupBy(input.fundPurchases, f => f.fund_code)) {
    const value = aggregatePortfolio({ ...base, fundPurchases: rows, fundNavs: input.fundNavs }).fundValue
    if (value > 0) out.push({ kind: 'Fund', name: opts.fundNames?.get(code) ?? code, value })
  }
  for (const b of opts.bonds ?? []) {
    if (b.principal > 0) out.push({ kind: 'Bond', name: b.series_code, value: b.principal, sovereign: b.series_type !== 'CORP' })
  }
  return out.sort((a, b) => b.value - a.value)
}

/** Share of net worth per asset class, keyed lower-case (stocks/gold/bonds/funds). */
export function allocationPct(current: PortfolioAggregate): Record<string, number | null> {
  return Object.fromEntries(current.products.map(p => [p.name.toLowerCase(), share(p.value, current.netWorth)]))
}

export function buildAllocationSection(current: PortfolioAggregate, holdings: HoldingValue[]): string {
  const nw = current.netWorth
  const lines = [
    '## Allocation & Concentration',
    '',
    '| Asset Class | Value | Share |',
    '|---|---:|---:|',
    ...current.products.map(p => `| ${p.name} | ${idr(p.value)} | ${pct1(share(p.value, nw))} |`),
    '',
  ]
  if (holdings.length > 0) {
    lines.push('**Largest holdings**', '', '| Holding | Class | Value | Share |', '|---|---|---:|---:|')
    for (const h of holdings.slice(0, 5)) {
      lines.push(`| ${h.name} | ${h.kind} | ${idr(h.value)} | ${pct1(share(h.value, nw))} |`)
    }
    lines.push('')
  }
  const warnings = [
    ...current.products
      .filter(p => (share(p.value, nw) ?? 0) > CONCENTRATION_CLASS_PCT)
      .map(p => `${p.name} is ${pct1(share(p.value, nw))} of net worth (above ${CONCENTRATION_CLASS_PCT}%).`),
    // A large sovereign series is not single-issuer risk; a corporate bond is.
    ...holdings
      .filter(h => !h.sovereign && (share(h.value, nw) ?? 0) > CONCENTRATION_HOLDING_PCT)
      .map(h => `${h.name} (${h.kind}) is ${pct1(share(h.value, nw))} of net worth (above ${CONCENTRATION_HOLDING_PCT}%).`),
  ]
  if (warnings.length > 0) lines.push(...warnings.map(w => `- ⚠️ ${w}`), '')
  return lines.join('\n')
}

/** Trades, income and fees whose WIB day falls in (weekStart, weekEnd]. */
export function collectWeekActivity(src: {
  transactions: StockTransactionRow[]
  goldPurchases: GoldPurchaseRow[]
  fundPurchases: FundPurchaseRow[]
  fxToIdr: Map<string, number>
  stockDividends: StockDividendRow[]
  fundDistributions: FundDistributionRow[]
  couponPayments: Array<{ bond_holding_id: number; paid_at: string; amount: number | null }>
  bonds: BondHoldingRow[]
  accountCharges: AccountChargeRow[]
}, weekStart: string, weekEnd: string): WeekActivity {
  const inWeek = (at: string): boolean => {
    const d = wibDay(at)
    return d > weekStart && d <= weekEnd
  }
  const fundName = new Map(src.fundPurchases.map(f => [f.fund_code, f.fund_name ?? f.fund_code]))
  const bondName = new Map(src.bonds.map(b => [b.id, b.series_code]))
  const toIdr = (currency: string | undefined, amount: number): number | null => {
    if (!currency || currency === 'IDR') return amount
    const fx = src.fxToIdr.get(currency)
    return fx == null ? null : amount * fx
  }

  const trades: ActivityRow[] = [
    ...src.transactions.filter(t => inWeek(t.txn_at)).map(t => ({
      date: wibDay(t.txn_at), kind: 'Stock', name: displayTicker(t.ticker), side: t.side,
      detail: `${t.lots} lots @ ${num(t.price)}${t.fee ? ` + fee ${num(t.fee)}` : ''}`,
      amount: t.lots * 100 * t.price,
    })),
    ...src.goldPurchases.filter(g => inWeek(g.purchased_at)).map(g => ({
      date: wibDay(g.purchased_at), kind: 'Gold', name: g.venue, side: g.side ?? 'BUY',
      detail: `${num(g.grams)} g @ ${num(g.buy_price_per_gram)}`,
      amount: g.grams * g.buy_price_per_gram,
    })),
    ...src.fundPurchases.filter(f => inWeek(f.purchased_at)).map(f => ({
      date: wibDay(f.purchased_at), kind: 'Fund', name: f.fund_name ?? f.fund_code, side: f.side ?? 'BUY',
      detail: `${num(f.units)} units @ ${num(f.buy_nav_per_unit)} ${f.currency ?? 'IDR'}`,
      amount: toIdr(f.currency, f.units * f.buy_nav_per_unit),
    })),
  ]
  const income: ActivityRow[] = [
    ...src.stockDividends.filter(d => inWeek(d.paid_at)).map(d => ({
      date: wibDay(d.paid_at), kind: 'Dividend', name: displayTicker(d.ticker), detail: d.notes ?? '', amount: d.amount,
    })),
    ...src.fundDistributions.filter(d => inWeek(d.paid_at)).map(d => ({
      date: wibDay(d.paid_at), kind: 'Distribution', name: fundName.get(d.fund_code) ?? d.fund_code, detail: d.notes ?? '', amount: d.amount,
    })),
    ...src.couponPayments.filter(c => inWeek(c.paid_at)).map(c => ({
      date: wibDay(c.paid_at), kind: 'Coupon', name: bondName.get(c.bond_holding_id) ?? `bond #${c.bond_holding_id}`, detail: '', amount: c.amount,
    })),
  ]
  const fees: ActivityRow[] = src.accountCharges.filter(c => inWeek(c.charged_at)).map(c => ({
    date: wibDay(c.charged_at), kind: c.type, name: '', detail: c.notes ?? '', amount: c.amount,
  }))
  const byDate = (a: ActivityRow, b: ActivityRow) => a.date.localeCompare(b.date)
  return { trades: trades.sort(byDate), income: income.sort(byDate), fees: fees.sort(byDate) }
}

export function activityTotals(a: WeekActivity): { bought: number; sold: number; income: number; fees: number } {
  const sum = (rows: ActivityRow[]) => rows.reduce((acc, r) => acc + (r.amount ?? 0), 0)
  return {
    bought: sum(a.trades.filter(t => t.side === 'BUY')),
    sold: sum(a.trades.filter(t => t.side === 'SELL')),
    income: sum(a.income),
    fees: sum(a.fees),
  }
}

export function buildActivitySection(a: WeekActivity, failed = false): string {
  const lines = ['## Activity This Week', '']
  if (failed) {
    lines.push('_⚠️ Activity unavailable — the fetch failed. Treat this as missing data, not a quiet week._', '')
    return lines.join('\n')
  }
  if (a.trades.length + a.income.length + a.fees.length === 0) {
    lines.push('_No trades, income or fees recorded this week._', '')
    return lines.join('\n')
  }
  const t = activityTotals(a)
  if (a.trades.length > 0) {
    lines.push('### Trades', '', '| Date | Asset | Name | Side | Detail | Amount |', '|---|---|---|---|---|---:|')
    for (const r of a.trades) lines.push(`| ${r.date} | ${r.kind} | ${r.name} | ${r.side} | ${r.detail} | ${idr(r.amount)} |`)
    lines.push('', `Bought ${idr(t.bought)} · Sold ${idr(t.sold)} · Net ${idr(t.bought - t.sold)} added.`, '')
  }
  if (a.income.length > 0) {
    lines.push('### Income Received', '', '| Date | Type | From | Amount |', '|---|---|---|---:|')
    for (const r of a.income) lines.push(`| ${r.date} | ${r.kind} | ${r.name} | ${idr(r.amount)} |`)
    lines.push('', `Total income: ${idr(t.income)}.`, '')
  }
  if (a.fees.length > 0) {
    lines.push('### Fees', '', '| Date | Type | Notes | Amount |', '|---|---|---|---:|')
    for (const r of a.fees) lines.push(`| ${r.date} | ${r.kind} | ${r.detail || '—'} | ${idr(r.amount)} |`)
    lines.push('', `Total fees: ${idr(t.fees)}.`, '')
  }
  return lines.join('\n')
}

/**
 * Dividend ex/pay dates for held tickers and bond coupons in [from, to], plus
 * bond maturities in [from, maturityTo].
 */
export function collectUpcoming(src: {
  schedule: DividendScheduleRow[]
  positions: Array<{ ticker: string; lots: number | null }>
  bonds: BondHoldingRow[]
  couponDates: Array<{ bond_holding_id: number; distribution_date: string }>
  couponPayments: Array<{ bond_holding_id: number; paid_at: string; amount: number | null }>
}, from: string, to: string, maturityTo: string): UpcomingEvent[] {
  const inRange = (d: string | null, end = to): d is string => d != null && d >= from && d <= end
  const shares = new Map(src.positions.filter(p => (p.lots ?? 0) > 0).map(p => [p.ticker.toUpperCase(), (p.lots ?? 0) * 100]))
  const events: UpcomingEvent[] = []

  for (const s of src.schedule) {
    const held = shares.get(s.ticker.toUpperCase())
    if (held == null) continue
    const per = s.amount_per_share
    const isIdr = !s.currency || s.currency === 'IDR'
    const detail = per == null
      ? 'amount not announced'
      : `${isIdr ? 'Rp' : s.currency} ${num(per)}/share${s.amount_estimated ? ' (est.)' : ''}` +
        (isIdr ? ` · ≈ ${fmtIdr(per * held)} on ${held.toLocaleString('id-ID')} shares` : '')
    const name = displayTicker(s.ticker)
    if (inRange(s.ex_date)) events.push({ date: s.ex_date, event: 'Ex-dividend', name, detail: `${detail} — hold through cum-date ${s.cum_date ?? 'N/A'}` })
    if (inRange(s.pay_date)) events.push({ date: s.pay_date, event: 'Dividend pay', name, detail })
  }

  const datesByBond = groupBy(src.couponDates, c => String(c.bond_holding_id))
  const lastPaid = latestPaymentByHolding(src.couponPayments)
  for (const b of src.bonds) {
    if (b.id == null) continue
    const dates = (datesByBond.get(String(b.id)) ?? []).map(c => c.distribution_date)
    const est = lastPaid.get(b.id)
      ?? (b.coupon_rate != null ? estimateCouponNet(b.principal, b.coupon_rate, inferPaymentsPerYear(dates)) : null)
    for (const d of dates) {
      if (inRange(d)) events.push({ date: d, event: 'Coupon', name: b.series_code, detail: est == null ? 'amount unknown' : `≈ ${fmtIdr(est)} net` })
    }
    if (inRange(b.maturity_date, maturityTo)) {
      events.push({ date: b.maturity_date, event: 'Maturity', name: b.series_code, detail: `${fmtIdr(b.principal)} principal returns — plan reinvestment` })
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

export function buildUpcomingSection(events: UpcomingEvent[], failed = false): string {
  const lines = ['## Coming Up', '']
  if (failed) {
    lines.push('_⚠️ Upcoming events unavailable — the fetch failed._', '')
  } else if (events.length === 0) {
    lines.push(`_No dividend dates or coupons in the next ${UPCOMING_DAYS} days, and no bond maturities in the next ${MATURITY_DAYS} days._`, '')
  } else {
    lines.push('| Date | Event | Holding | Detail |', '|---|---|---|---|')
    for (const e of events) lines.push(`| ${e.date} | ${e.event} | ${e.name} | ${e.detail} |`)
    lines.push('', `_Dividends and coupons: next ${UPCOMING_DAYS} days. Maturities: next ${MATURITY_DAYS} days._`, '')
  }
  return lines.join('\n')
}

export function buildHandoverDoc(args: {
  weekStart: string
  weekEnd: string
  model: string
  numbersSection: string
  /** Allocation, activity and coming-up sections; optional so the stock-only shape still builds. */
  portfolioSections?: string[]
  ledgerSection: string
  newsSection: string
  accuracy: RecommendationAccuracyRow[]
  sampleRawOutput: string | null
  failures?: LedgerFailures
}): string {
  const accLines = args.accuracy.length === 0
    ? [args.failures?.accuracy
        ? '_⚠️ Scoring query failed — accuracy data is missing, not empty._'
        : '_No scored recommendations available._']
    : [
        '| Ticker | Rec | Class | Analysed | Price@Rec | Price+Nd | Move | IHSG | Correct |',
        '|---|---|---|---|---:|---:|---:|---:|---|',
        ...args.accuracy.map(a =>
          `| ${displayTicker(a.ticker)} | ${a.recommendation} | ${a.rec_class ?? 'N/A'} | ${(a.analysed_at ?? '').slice(0, 10)} | ${a.price_at_rec ?? 'N/A'} | ${a.price_after ?? 'N/A'} | ${pct(a.actual_change_pct)} | ${pct(a.benchmark_change_pct)} | ${a.correct == null ? 'N/A' : a.correct ? 'yes' : 'no'} |`),
      ]
  return [
    `# Folionix Analysis Handover — week ${args.weekStart} → ${args.weekEnd}`,
    '',
    '> **Instructions for the reviewing LLM:** You are auditing a small self-hosted',
    '> portfolio-analysis system (IDX stocks, gold, mutual funds, government bonds) that',
    '> runs a local model with limited context. Only stocks get LLM recommendations; gold,',
    '> funds and bonds are tracked and valued. Using the raw data below, assess the quality',
    '> of last week\'s recommendations and the portfolio as a whole, and propose concrete',
    '> improvements: (1) additional data sources worth ingesting, (2) specific prompt',
    '> changes (structure, framing, output format), (3) recommendation-policy fixes',
    '> (thresholds, dedup, timing), (4) portfolio-level gaps (allocation, concentration,',
    '> income, upcoming cash events) the system should surface. Be specific and actionable;',
    '> assume changes must run on a local LLM with ~4k output tokens.',
    '',
    '## System description',
    '',
    `- Analysis model: \`${args.model}\` via Vercel AI SDK (Ollama or an OpenAI-compatible gateway), temperature 0.3, max ~4096 output tokens.`,
    '- Per-ticker prompt contains: IDX market-session label (WIB), price block (current, day change, volume, 52w range), investor position (lots, avg price, P&L) for held stocks, fundamentals (P/E, P/B, dividend yield, market cap) on FULL/DEEP depth, a TECHNICALS block computed from snapshot history (SMA20/50, RSI14, 1W momentum, volume vs 20d avg, IHSG relative strength), optional news-sentiment summary (RSS headlines summarized by the same LLM), and a required Telegram-HTML output template ending in a mandatory `REKOMENDASI: <keyword>` line.',
    '- Held positions get action sizing vs a Rp 1,000,000 materiality threshold but must still state a market view; watchlist tickers are asked for a pure entry signal (BUY / MONITOR / HOLD) with no threshold.',
    '- Recommendation extracted from the REKOMENDASI line (fallback: keyword scan): AVERAGE DOWN, TAKE PROFIT, CUT LOSS, HOLD, MONITOR, BUY, TRIM.',
    '- Data sources today: yahoo-finance2 (prices + fundamentals), Google News RSS (sentiment), own snapshot history (technicals), IDX-IC peer groups (sector-relative valuation), Finnhub (optional fallback, USD). No broker flow, no order-book data.',
    '- Non-stock assets: gold valued at the venue sell-back price (Cermati), mutual funds at latest NAV (Cermati, fx-converted), bonds at par. Income (dividends, fund distributions, coupons) is tracked separately from capital; Total Return = Capital + Income − Fees.',
    '- Accuracy scoring: one rec per ticker per WIB day (the last); BUY-ish correct when price rises after N days, SELL-ish when it falls. HOLD-ish is scored against IHSG — correct when the ticker tracked the index within 1.5pp over the window, since a HOLD is a decision to do nothing and the question is whether doing nothing cost anything. Absolute |move| < 5% is the fallback only when no IHSG snapshot brackets the window.',
    '',
    args.numbersSection,
    ...(args.portfolioSections ?? []),
    args.ledgerSection,
    args.newsSection,
    '## Full accuracy sample (last scored recommendations)',
    '',
    ...accLines,
    '',
    '## Sample raw model output (most recent recommendation)',
    '',
    '```',
    args.sampleRawOutput?.slice(0, 2000) ?? '(none this week)',
    '```',
    '',
    '## What to return',
    '',
    '1. Top 3 weaknesses observed in the recommendations vs actual outcomes.',
    '2. Data sources to add, ranked by expected impact vs integration effort.',
    '3. A revised prompt template (drop-in replacement) tuned for a small local model.',
    '4. Portfolio-level observations: allocation drift, concentration, income cadence, and what the weekly review should track that it does not.',
    '',
  ].join('\n')
}

// ── LLM SELF-CRITIQUE ───────────────────────────────────────────────────────

async function buildSelfCritique(sections: string[]): Promise<string> {
  const system = 'You are reviewing the weekly output of an automated portfolio system covering IDX stocks, gold, mutual funds and Indonesian government bonds. Be candid and concrete.'
  const prompt = [
    'Below are this week\'s portfolio numbers, allocation, trades/income/fees, upcoming dividend and bond events, the stock recommendations the system issued with outcomes, and the news sentiment fed into those recommendations.',
    '',
    ...sections,
    'Write a short self-review in plain markdown (max 250 words):',
    '1. What the recommendations got right or wrong this week (cite tickers), and whether news sentiment aligned with outcomes — call out tickers where they diverged.',
    '2. The portfolio as a whole: how stocks, gold, funds and bonds each moved, any concentration warning, and whether this week\'s trades moved allocation toward or away from balance.',
    '3. One thing to act on or watch next week (cite an upcoming event if relevant).',
    '4. One concrete improvement to the analysis system (data or prompt).',
    'No preamble, no HTML.',
  ].join('\n')
  try {
    const text = await callLlm(prompt, { system })
    return `## AI Self-Review\n\n${text.trim()}\n`
  } catch (err) {
    console.error('[weekReview] self-critique LLM failed:', err instanceof Error ? err.message : err)
    return '## AI Self-Review\n\n_Local LLM unavailable this week — see handover document for raw data._\n'
  }
}

// ── PIPELINE ────────────────────────────────────────────────────────────────

export async function runWeekReview(opts?: { send?: boolean }): Promise<WeekReviewResult> {
  const send = opts?.send ?? true
  const now = new Date()
  const weekAgoDate = new Date(now.getTime() - 7 * 86_400_000)
  const weekStart = wibDateOffset(-7)
  const weekEnd = wibDateOffset(0)
  console.log(`[weekReview] generating review ${weekStart} → ${weekEnd}`)

  const [
    positions, snapshots, goldPurchases, goldPrices, bonds, bondPayments,
    fundPurchases, fundNavs, fxToIdr, stockDividends, fundDistributions, accountCharges,
  ] = await Promise.all([
    getAllPositions(), getLatestSnapshots(), getGoldPurchases(), getLatestGoldPrices(),
    getBondHoldings(), getBondCouponPayments(), getFundPurchases(), getLatestFundNavs(),
    getForexRatesToIdr(), getStockDividends(), getFundDistributions(), getAccountCharges(),
  ])

  const baseInput = {
    positions, snapshots, goldPurchases, goldPrices,
    bonds: bonds.map(b => ({ principal: b.principal, purchase_price: b.purchase_price ?? null })),
    bondPayments, fundPurchases, fundNavs, fxToIdr,
    stockDividends, fundDistributions, accountCharges,
  }
  const current = aggregatePortfolio(baseInput)
  const fundNames = new Map(fundPurchases.map(f => [f.fund_code, f.fund_name ?? f.fund_code]))
  const holdings = holdingValues(baseInput, { fundNames, bonds })

  // ── Week-ago aggregate: same holdings, week-ago prices ──
  let weekAgoAgg: PortfolioAggregate | null = null
  const stockChanges: StockWeekChange[] = []
  const assetMoves: AssetMove[] = []
  try {
    // Week-ago lookups are independent per ticker/venue/fund — fetch them
    // concurrently instead of one serial round-trip each.
    const oldSnaps: StockSnapshotRow[] = []
    const perPosition = await Promise.all(
      positions.map(async (p) => ({ ticker: p.ticker, old: await getSnapshotBefore(p.ticker, weekAgoDate) })),
    )
    for (const { ticker, old } of perPosition) {
      if (old) oldSnaps.push(old)
      const nowPrice = snapshots.find(s => s.ticker.toUpperCase() === ticker.toUpperCase())?.current_price ?? null
      const oldPrice = old?.current_price ?? null
      stockChanges.push({
        ticker,
        priceNow: nowPrice,
        priceWeekAgo: oldPrice,
        changePct: nowPrice != null && oldPrice ? ((nowPrice - oldPrice) / oldPrice) * 100 : null,
      })
    }
    const oldGoldPrices = await Promise.all(
      [...new Set(goldPurchases.map(g => g.venue))].map(async (venue) =>
        ({ venue, sell_price: await getGoldPriceBefore(venue, weekAgoDate) })),
    )
    const oldNavs = await Promise.all(
      [...new Set(fundPurchases.map(f => f.fund_code))].map(async (code) =>
        ({ fund_code: code, nav: await getFundNavBefore(code, weekAgoDate) })),
    )
    for (const { venue, sell_price } of oldGoldPrices) {
      const now = goldPrices.find(g => g.venue === venue)?.sell_price ?? null
      assetMoves.push({ kind: 'Gold', name: venue, unit: 'IDR/g', now, weekAgo: sell_price })
    }
    for (const { fund_code, nav } of oldNavs) {
      const now = fundNavs.find(n => n.fund_code === fund_code)?.nav ?? null
      const currency = fundPurchases.find(f => f.fund_code === fund_code)?.currency ?? 'IDR'
      assetMoves.push({ kind: 'Fund', name: fundNames.get(fund_code) ?? fund_code, unit: `${currency}/unit`, now, weekAgo: nav })
    }
    weekAgoAgg = aggregatePortfolio({
      ...baseInput,
      snapshots: oldSnaps,
      goldPrices: oldGoldPrices,
      fundNavs: oldNavs,
    })
  } catch (err) {
    console.error('[weekReview] week-ago aggregate failed:', err instanceof Error ? err.message : err)
  }

  // ── Recommendation ledger + accuracy ──
  let ledger: RecLedgerEntry[] = []
  let weekAnalyses: LlmAnalysisRow[] = []
  let accuracy: RecommendationAccuracyRow[] = []
  const failures: LedgerFailures = {}
  try {
    weekAnalyses = await withRetry('getAnalysesBetween', () => getAnalysesBetween(weekAgoDate, now))
    const changed = weekAnalyses.filter(a => !a.skipped_same && a.recommendation)
    // One batched price query instead of one request per recommendation: the
    // old fan-out (hundreds of concurrent reads) made a single transient
    // failure wipe the whole ledger. Buffer back a few days so recs at the
    // very start of the window still find a prior snapshot.
    const priceSince = new Date(weekAgoDate.getTime() - 3 * 86_400_000)
    const points = await withRetry('getSnapshotPricesSince',
      () => getSnapshotPricesSince(changed.map(a => a.ticker), priceSince))
    const byTicker = new Map<string, Array<{ current_price: number | null; fetched_at: string }>>()
    for (const p of points) {
      const key = p.ticker.toUpperCase()
      const arr = byTicker.get(key)
      if (arr) arr.push(p)
      else byTicker.set(key, [p])
    }
    ledger = changed.map(a => {
      const at = a.analysed_at ? new Date(a.analysed_at) : now
      const priceAtRec = priceAt(byTicker.get(a.ticker.toUpperCase()), at)
      const priceNow = snapshots.find(s => s.ticker.toUpperCase() === a.ticker.toUpperCase())?.current_price ?? null
      return {
        ticker: a.ticker,
        recommendation: a.recommendation ?? 'UNKNOWN',
        analysedAt: a.analysed_at ?? '',
        model: a.model ?? null,
        priceAtRec,
        priceNow,
        changeSincePct: priceAtRec && priceNow != null ? ((priceNow - priceAtRec) / priceAtRec) * 100 : null,
      }
    })
  } catch (err) {
    failures.ledger = true
    console.error('[weekReview] ledger build failed:', err instanceof Error ? err.message : err)
  }
  try {
    accuracy = await withRetry('recommendation_accuracy', () => getRecommendationAccuracy(3))
  } catch (err) {
    failures.accuracy = true
    console.error('[weekReview] accuracy RPC failed:', err instanceof Error ? err.message : err)
  }

  // ── News sentiment recorded during the week ──
  let sentiments: NewsSentimentRow[] = []
  try {
    sentiments = await getSentimentsBetween(weekAgoDate, now)
  } catch (err) {
    console.error('[weekReview] sentiment fetch failed:', err instanceof Error ? err.message : err)
  }

  // ── Trades, income and fees during the week ──
  let activity: WeekActivity = { trades: [], income: [], fees: [] }
  let activityFailed = false
  let couponPayments: Array<{ bond_holding_id: number; paid_at: string; amount: number | null }> = []
  try {
    const [transactions, payments] = await Promise.all([getStockTransactions(), getBondCouponPaymentRows()])
    couponPayments = payments
    activity = collectWeekActivity({
      transactions, goldPurchases, fundPurchases, fxToIdr, stockDividends, fundDistributions,
      couponPayments, bonds, accountCharges,
    }, weekStart, weekEnd)
  } catch (err) {
    activityFailed = true
    console.error('[weekReview] activity fetch failed:', err instanceof Error ? err.message : err)
  }

  // ── Dividend dates, coupons and maturities ahead ──
  let upcoming: UpcomingEvent[] = []
  let upcomingFailed = false
  try {
    const [schedule, couponDates] = await Promise.all([
      getDividendScheduleBetween(weekEnd, wibDateOffset(UPCOMING_DAYS)), getBondCouponScheduleDates(),
    ])
    upcoming = collectUpcoming({ schedule, positions, bonds, couponDates, couponPayments },
      weekEnd, wibDateOffset(UPCOMING_DAYS), wibDateOffset(MATURITY_DAYS))
  } catch (err) {
    upcomingFailed = true
    console.error('[weekReview] upcoming fetch failed:', err instanceof Error ? err.message : err)
  }

  // ── Assemble sections ──
  const numbersSection = buildNumbersSection(current, weekAgoAgg, stockChanges, assetMoves)
  const portfolioSections = [
    buildAllocationSection(current, holdings),
    buildActivitySection(activity, activityFailed),
    buildUpcomingSection(upcoming, upcomingFailed),
  ]
  const ledgerSection = buildLedgerSection(ledger, accuracy, failures)
  const newsSection = buildNewsSection(sentiments)
  const critiqueSection = await buildSelfCritique([numbersSection, ...portfolioSections, ledgerSection, newsSection])

  const model = process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown'
  const reportMd = [
    `# Folionix Week Review — ${weekStart} → ${weekEnd}`,
    '',
    numbersSection,
    ...portfolioSections,
    ledgerSection,
    newsSection,
    critiqueSection,
  ].join('\n')

  const lastWithOutput = [...weekAnalyses].reverse().find(a => a.raw_output)
  const handoverMd = buildHandoverDoc({
    weekStart, weekEnd, model,
    numbersSection, portfolioSections, ledgerSection, newsSection, accuracy,
    sampleRawOutput: lastWithOutput?.raw_output ?? null,
    failures,
  })

  const scored = accuracy.filter(a => a.correct != null)
  const totals = activityTotals(activity)
  const alloc = allocationPct(current)
  const top = holdings[0]
  const stats: WeekReviewStats = {
    net_worth: current.netWorth,
    net_worth_week_ago: weekAgoAgg?.netWorth ?? null,
    wow_pct: weekAgoAgg && weekAgoAgg.netWorth !== 0
      ? ((current.netWorth - weekAgoAgg.netWorth) / Math.abs(weekAgoAgg.netWorth)) * 100
      : null,
    combined_pnl: current.combinedPnl,
    total_return: current.totalReturn,
    rec_total: weekAnalyses.length,
    rec_changed: ledger.length,
    accuracy_pct: scored.length > 0 ? (scored.filter(a => a.correct).length / scored.length) * 100 : null,
    accuracy_n: scored.length,
    alloc_pct: alloc,
    top_holding: top ? { name: top.name, kind: top.kind, pct: current.netWorth > 0 ? (top.value / current.netWorth) * 100 : null } : null,
    income_week: activityFailed ? null : totals.income,
    fees_week: activityFailed ? null : totals.fees,
    net_bought_week: activityFailed ? null : totals.bought - totals.sold,
    upcoming_events: upcomingFailed ? null : upcoming.length,
  }

  const id = await saveWeeklyReview({
    week_start: weekStart, week_end: weekEnd,
    report_md: reportMd, handover_md: handoverMd,
    stats, model, emailed: false,
  })
  console.log(`[weekReview] saved review #${id}`)

  if (send) {
    // Telegram: short summary ping (HTML)
    try {
      const wowStr = stats.wow_pct != null ? `${stats.wow_pct >= 0 ? '+' : ''}${stats.wow_pct.toFixed(2)}%` : 'N/A'
      const accStr = stats.accuracy_pct != null ? `${stats.accuracy_pct.toFixed(0)}% (n=${stats.accuracy_n})` : 'N/A'
      await sendTelegram(
        `<b>📊 Week Review ${weekStart} → ${weekEnd}</b>\n` +
        `Net Worth: <code>${fmtIdr(current.netWorth)}</code> (${wowStr} WoW)\n` +
        `Mix: ${current.products.map(p => `${p.name} ${pct1(alloc[p.name.toLowerCase()] ?? null)}`).join(' · ')}\n` +
        (activityFailed ? '' : `Income ${fmtIdr(totals.income)} · Fees ${fmtIdr(totals.fees)} this week\n`) +
        (upcoming.length > 0 ? `Coming up: ${upcoming.length} dividend/bond event${upcoming.length === 1 ? '' : 's'}\n` : '') +
        `Recommendations: ${failures.ledger ? 'unavailable (fetch failed)' : `${stats.rec_changed} new`}, accuracy ${failures.accuracy ? 'unavailable' : accStr}\n` +
        `Full report + handover doc on the dashboard → /reviews`,
      )
    } catch (err) {
      console.error('[weekReview] telegram ping failed:', err instanceof Error ? err.message : err)
    }

    // Email: full report body + handover as attachment
    const emailed = await sendEmailMarkdown(
      `Folionix Week Review ${weekStart} → ${weekEnd}`,
      reportMd,
      [{ filename: `folionix-handover-${weekEnd}.md`, content: handoverMd }],
    )
    if (emailed) {
      try { 
        await markWeeklyReviewEmailed(id) 
      } catch (err) {
        console.error('[weekReview] Failed to mark review emailed:', err instanceof Error ? err.message : err)
      }
    }
  }

  return { id, weekStart, weekEnd, reportMd, handoverMd, stats }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1]?.endsWith('weekReview.ts') || process.argv[1]?.endsWith('weekReview.js')
if (isMain) {
  const send = !process.argv.includes('--no-send')
  runWeekReview({ send })
    .then(r => { console.log(`[weekReview] done — review #${r.id}`); process.exit(0) })
    .catch(err => { console.error('[weekReview] failed:', err); process.exit(1) })
}
