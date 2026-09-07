import 'dotenv/config'
import YahooFinance from 'yahoo-finance2'
import { calcPnl, normalizeTicker, WIB } from '../../../lib/format'
import { getForexRatesToIdr, getLatestSnapshot } from '../db/db'
import type { SnapshotInput } from '../db/db'
import { fetchFinnhubQuote } from './finnhub'
import { withRetry } from '../utils/retry'

const CACHE_MINUTES = Number(process.env.CACHE_MINUTES ?? 15)

// v3 exports the YahooFinance class as default; one shared instance keeps the
// cookie/crumb jar warm across tickers.
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

/**
 * Yahoo divides an IDR share price by a book value per share reported in the
 * issuer's *financial* currency, so USD reporters (most IDX coal/mining names)
 * come back with a P/B inflated by the USD/IDR rate — AADI at 19,786 instead
 * of ~1.1. Recompute from bookValue when the currencies disagree; return null
 * rather than a junk ratio when we cannot convert, so the analysis prompt
 * simply omits P/B instead of reasoning about a fabricated one.
 */
export function correctPriceToBook(q: {
  reportedPb: number | null
  price: number | null
  bookValue: number | null | undefined
  quoteCurrency: string | null | undefined
  financialCurrency: string | null | undefined
  fxToIdr: Map<string, number>
}): number | null {
  const { reportedPb, price, bookValue, quoteCurrency, financialCurrency, fxToIdr } = q
  if (reportedPb == null) return null
  // Currencies agree (or yahoo did not say) — the ratio is already consistent.
  if (!financialCurrency || !quoteCurrency || financialCurrency === quoteCurrency) return reportedPb
  if (quoteCurrency !== 'IDR') return null  // only IDR rates are maintained
  const rate = fxToIdr.get(financialCurrency)
  if (!rate || !price || !bookValue) return null
  const bookValueIdr = bookValue * rate
  return bookValueIdr > 0 ? price / bookValueIdr : null
}

/** USD/IDR et al., memoised for a few minutes — fetchStock runs per ticker. */
let fxCache: { at: number; rates: Map<string, number> } | null = null
async function fxRatesToIdr(): Promise<Map<string, number>> {
  if (fxCache && Date.now() - fxCache.at < 15 * 60_000) return fxCache.rates
  try {
    const rates = await getForexRatesToIdr()
    fxCache = { at: Date.now(), rates }
    return rates
  } catch (err) {
    console.warn('[market] forex rates unavailable:', err instanceof Error ? err.message : err)
    return fxCache?.rates ?? new Map()
  }
}

export async function fetchStock(
  ticker: string,
  avgPrice: number,
  lots: number,
  notes: string | null,
  force = false,
): Promise<SnapshotInput> {
  // Storage is keyed by the yahoo symbol ('BBCA.JK', '^JKSE') everywhere —
  // positions/watchlist/analyses/snapshots all carry the exchange suffix
  // (migration 024); the UI strips it for display only.
  const jkTicker = normalizeTicker(ticker)
  const storeTicker = jkTicker

  if (!force) {
    const cached = await getLatestSnapshot(storeTicker)
    if (cached?.fetched_at) {
      const age = (Date.now() - new Date(cached.fetched_at).getTime()) / 60_000
      if (age < CACHE_MINUTES) {
        const { id: _id, fetched_at: _fetched, ...snap } = cached
        return snap as unknown as SnapshotInput
      }
    }
  }

  let price: number | null = null
  let dayChange: number | null = null
  let dayChangePct: number | null = null
  let high52w: number | null = null
  let low52w: number | null = null
  let volume: number | null = null
  let marketCap: number | null = null
  let peRatio: number | null = null
  let pbRatio: number | null = null
  let dividendYield: number | null = null
  let bookValue: number | null = null
  let quoteCurrency: string | null = null
  let financialCurrency: string | null = null

  try {
    // 2 attempts, short delay — transient network blips only; a real outage
    // should fall through to the Finnhub fallback below quickly, not stall here.
    const quote = await withRetry(() => yf.quote(jkTicker), 2, 500)
    price = quote.regularMarketPrice ?? null
    dayChange = quote.regularMarketChange ?? null
    dayChangePct = quote.regularMarketChangePercent ?? null
    high52w = quote.fiftyTwoWeekHigh ?? null
    low52w = quote.fiftyTwoWeekLow ?? null
    volume = quote.regularMarketVolume ?? null
    marketCap = quote.marketCap ?? null
    // Fundamentals available directly from quote response
    peRatio = quote.trailingPE ?? null
    pbRatio = quote.priceToBook ?? null
    dividendYield = quote.trailingAnnualDividendYield ?? null
    bookValue = quote.bookValue ?? null
    quoteCurrency = quote.currency ?? null
    financialCurrency = quote.financialCurrency ?? null
  } catch {
    // yfinance failed — try Finnhub fallback below
  }

  // yahoo's quote endpoint lags for freshly-listed tickers (new IPOs return a
  // null price there for days) while the chart endpoint already has data. Try
  // it before falling back to Finnhub so new listings still get a price.
  if (!price) {
    try {
      const chart = await withRetry(
        () => yf.chart(jkTicker, { period1: new Date(Date.now() - 7 * 86_400_000), interval: '1d' }),
        2,
        500,
      )
      const m = chart.meta
      price = m.regularMarketPrice ?? null
      high52w = high52w ?? m.fiftyTwoWeekHigh ?? null
      low52w = low52w ?? m.fiftyTwoWeekLow ?? null
      volume = volume ?? m.regularMarketVolume ?? null
      if (price != null && m.chartPreviousClose != null) {
        dayChange = price - m.chartPreviousClose
        dayChangePct = m.chartPreviousClose ? (dayChange / m.chartPreviousClose) * 100 : null
      }
    } catch {
      // chart failed too — fall through to Finnhub
    }
  }

  if (!price) {
    const fb = await fetchFinnhubQuote(jkTicker)
    if (fb) {
      // Finnhub symbols can collide with other exchanges' listings (quoted in
      // USD); reject a fallback price wildly off the last stored snapshot
      // rather than poisoning history — IDX daily limits cap moves at ~35%.
      const last = await getLatestSnapshot(storeTicker)
      const ref = last?.current_price
      if (ref == null || Math.abs(fb.c - ref) / ref <= 0.5) {
        price = fb.c
        dayChange = fb.d
        dayChangePct = fb.dp
        high52w = fb.h
        low52w = fb.l
      } else {
        console.warn(`[market] rejected implausible Finnhub fallback for ${jkTicker}: ${fb.c} vs last ${ref}`)
      }
    }
  }

  if (pbRatio != null && financialCurrency && financialCurrency !== quoteCurrency) {
    pbRatio = correctPriceToBook({
      reportedPb: pbRatio, price, bookValue, quoteCurrency, financialCurrency,
      fxToIdr: await fxRatesToIdr(),
    })
  }

  const { pnl, pnlPct, totalPnl } = price
    ? calcPnl(price, avgPrice, lots)
    : { pnl: null, pnlPct: null, totalPnl: null }

  const position_status = pnl !== null
    ? (pnl > 0 ? 'PROFIT' : pnl < 0 ? 'LOSS' : 'BREAKEVEN')
    : null

  const dist_from_high = high52w && price ? ((price - high52w) / high52w) * 100 : null
  const dist_from_low = low52w && price ? ((price - low52w) / low52w) * 100 : null

  return {
    ticker: storeTicker,
    current_price: price,
    day_change: dayChange,
    day_change_pct: dayChangePct,
    high_52w: high52w,
    low_52w: low52w,
    market_cap_raw: marketCap,
    pe: peRatio,
    pb: pbRatio,
    div_yield_pct: dividendYield,
    volume,
    lots,
    avg_price: avgPrice,
    unrealized_pnl: pnl,
    unrealized_pnl_pct: pnlPct,
    total_pnl: totalPnl,
    position_status,
    dist_from_high,
    dist_from_low,
  } as SnapshotInput
}

// ── DIVIDEND SCHEDULE ──

export interface DividendDates {
  ex_date: string
  pay_date: string | null
  amount_per_share: number | null
}

/** Coerce a yahoo date field (Date or unix seconds) to a WIB YYYY-MM-DD, or null. */
function toWibDate(v: Date | number | null | undefined): string | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v * 1000)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { timeZone: WIB })
}

/** Next dividend ex/pay dates + per-share estimate for a ticker; null if none. */
export async function fetchDividendDates(ticker: string): Promise<DividendDates | null> {
  const jkTicker = normalizeTicker(ticker)
  const quote = await withRetry(() => yf.quote(jkTicker), 2, 500)
  const ex = toWibDate(quote.exDividendDate as Date | number | undefined)
  if (!ex) return null
  return {
    ex_date: ex,
    pay_date: toWibDate(quote.dividendDate as Date | number | undefined),
    amount_per_share: quote.trailingAnnualDividendRate ?? null,
  }
}

/** Yahoo trailing-annual dividend per share for a ticker; null when absent or 0. */
export async function fetchDividendAmount(ticker: string): Promise<number | null> {
  const jkTicker = normalizeTicker(ticker)
  const quote = await withRetry(() => yf.quote(jkTicker), 2, 500)
  const rate = quote.trailingAnnualDividendRate
  return typeof rate === 'number' && rate > 0 ? rate : null
}

// ── FUNDAMENTALS ──

export interface KeyStats {
  forward_pe: number | null
  peg_ratio: number | null
  price_to_book: number | null
  enterprise_value: number | null
  book_value: number | null
  trailing_eps: number | null
  forward_eps: number | null
  profit_margins: number | null
  ebitda_margins: number | null
  return_on_equity: number | null
  revenue_growth: number | null
  earnings_growth: number | null
  current_ratio: number | null
  quick_ratio: number | null
  total_cash: number | null
  total_debt: number | null
  free_cashflow: number | null
  operating_cashflow: number | null
  target_mean: number | null
  target_high: number | null
  target_low: number | null
  recommendation_key: string | null
  analyst_count: number | null
  shares_outstanding: number | null
  float_shares: number | null
  held_pct_insiders: number | null
  held_pct_institutions: number | null
  change_52w: number | null
}

/** Yahoo returns undefined for absent fields; the DB wants null. */
function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

type RawSummary = {
  defaultKeyStatistics?: Record<string, unknown>
  financialData?: Record<string, unknown>
  summaryDetail?: Record<string, unknown>
  price?: Record<string, unknown>
}

/**
 * Same USD-financial-reporting problem as correctPriceToBook, but for a raw
 * per-share amount (book value, EPS) instead of a ratio: convert it into the
 * quote currency using the same fx map, or null when we cannot.
 */
function correctPerShare(
  value: number | null,
  financialCurrency: string | null,
  quoteCurrency: string | null,
  fxToIdr: Map<string, number>,
): number | null {
  if (value == null) return null
  if (!financialCurrency || !quoteCurrency || financialCurrency === quoteCurrency) return value
  if (quoteCurrency !== 'IDR') return null  // only IDR rates are maintained
  const rate = fxToIdr.get(financialCurrency)
  return rate ? value * rate : null
}

/** Pure mapping from a quoteSummary payload to KeyStats. Exported for tests. */
export function mapKeyStats(raw: RawSummary, fxToIdr: Map<string, number>): KeyStats {
  const k = raw.defaultKeyStatistics ?? {}
  const f = raw.financialData ?? {}
  const sd = raw.summaryDetail ?? {}
  const p = raw.price ?? {}
  const financialCurrency = s(f.financialCurrency)
  const quoteCurrency = s(sd.currency)
  const price = n(p.regularMarketPrice)
  const rawBookValue = n(k.bookValue)
  return {
    forward_pe: n(k.forwardPE),
    peg_ratio: n(k.pegRatio),
    price_to_book: correctPriceToBook({
      reportedPb: n(k.priceToBook),
      price,
      bookValue: rawBookValue,
      quoteCurrency,
      financialCurrency,
      fxToIdr,
    }),
    enterprise_value: n(k.enterpriseValue),
    book_value: correctPerShare(rawBookValue, financialCurrency, quoteCurrency, fxToIdr),
    trailing_eps: correctPerShare(n(k.trailingEps), financialCurrency, quoteCurrency, fxToIdr),
    forward_eps: correctPerShare(n(k.forwardEps), financialCurrency, quoteCurrency, fxToIdr),
    profit_margins: n(k.profitMargins),
    ebitda_margins: n(f.ebitdaMargins),
    return_on_equity: n(f.returnOnEquity),
    revenue_growth: n(f.revenueGrowth),
    earnings_growth: n(f.earningsGrowth),
    current_ratio: n(f.currentRatio),
    quick_ratio: n(f.quickRatio),
    total_cash: n(f.totalCash),
    total_debt: n(f.totalDebt),
    free_cashflow: n(f.freeCashflow),
    operating_cashflow: n(f.operatingCashflow),
    target_mean: n(f.targetMeanPrice),
    target_high: n(f.targetHighPrice),
    target_low: n(f.targetLowPrice),
    recommendation_key: s(f.recommendationKey),
    analyst_count: n(f.numberOfAnalystOpinions),
    shares_outstanding: n(k.sharesOutstanding),
    float_shares: n(k.floatShares),
    held_pct_insiders: n(k.heldPercentInsiders),
    held_pct_institutions: n(k.heldPercentInstitutions),
    change_52w: n(k['52WeekChange']),
  }
}

/**
 * Key statistics for one ticker. Returns null when the whole call fails; a
 * ticker with no analyst coverage still returns an object full of nulls,
 * which is a real answer and not an error.
 *
 * validateResult is off deliberately: strict schema validation discarded the
 * entire payload for HEAL.JK over three missing optional fields.
 */
export async function fetchKeyStats(ticker: string): Promise<KeyStats | null> {
  const symbol = normalizeTicker(ticker)
  try {
    const raw = await withRetry(() =>
      yf.quoteSummary(symbol,
        { modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail', 'price'] },
        { validateResult: false }))
    return mapKeyStats(raw as RawSummary, await fxRatesToIdr())
  } catch (err) {
    console.error(`[market] keyStats ${symbol}:`, err instanceof Error ? err.message : err)
    return null
  }
}

export interface FinancialPeriod {
  period_end: string
  period_type: 'QUARTERLY' | 'ANNUAL'
  revenue: number | null
  cost_of_revenue: number | null
  gross_profit: number | null
  operating_income: number | null
  net_income: number | null
  eps: number | null
  gross_margin_pct: number | null
  operating_margin_pct: number | null
  net_margin_pct: number | null
  currency: string | null
}

/** Margin as a percentage, or null when the denominator is missing or zero. */
function marginPct(part: number | null, revenue: number | null): number | null {
  if (part == null || revenue == null || revenue === 0) return null
  const pct = (part / revenue) * 100
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null
}

/** Slice a Date, ISO string, or numeric epoch-seconds value to YYYY-MM-DD. */
function toDay(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && v.length >= 10) return v.slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString().slice(0, 10)
  return null
}

/**
 * Pure mapping of one yahoo income-statement row. Margins are computed here,
 * on write, so consumers (and a future prompt change) read one column instead
 * of redoing the arithmetic.
 */
export function mapFinancialPeriod(
  row: Record<string, unknown>, currency: string | null,
): FinancialPeriod {
  const revenue = n(row.totalRevenue)
  return {
    period_end: toDay(row.endDate) ?? '1970-01-01',
    period_type: 'QUARTERLY',
    revenue,
    cost_of_revenue: n(row.costOfRevenue),
    gross_profit: n(row.grossProfit),
    operating_income: n(row.operatingIncome),
    net_income: n(row.netIncome),
    eps: n(row.dilutedEPS) ?? n(row.basicEPS),
    gross_margin_pct: marginPct(n(row.grossProfit), revenue),
    operating_margin_pct: marginPct(n(row.operatingIncome), revenue),
    net_margin_pct: marginPct(n(row.netIncome), revenue),
    currency,
  }
}

/**
 * Recent quarterly income statements, newest first. [] when the issuer has
 * none published, which is the normal state for thin IDX small-caps.
 *
 * yahoo-finance2 prints a deprecation notice for this module and steers to
 * fundamentalsTimeSeries. It still returned 4 periods for 4 of 5 probed IDX
 * tickers. If it goes empty across the board, switch to fundamentalsTimeSeries
 * here; nothing above this function needs to change.
 */
export async function fetchFinancials(ticker: string): Promise<FinancialPeriod[]> {
  const symbol = normalizeTicker(ticker)
  try {
    const raw = await withRetry(() =>
      yf.quoteSummary(symbol,
        { modules: ['incomeStatementHistoryQuarterly', 'summaryDetail'] },
        { validateResult: false })) as {
          incomeStatementHistoryQuarterly?: { incomeStatementHistory?: Record<string, unknown>[] }
          summaryDetail?: { currency?: string }
        }
    const rows = raw.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []
    const currency = s(raw.summaryDetail?.currency)?.toUpperCase() ?? null
    return rows
      .map((r) => mapFinancialPeriod(r, currency))
      .filter((p) => p.period_end !== '1970-01-01')
      .sort((a, b) => b.period_end.localeCompare(a.period_end))
  } catch (err) {
    console.error(`[market] financials ${symbol}:`, err instanceof Error ? err.message : err)
    return []
  }
}

export interface SplitEvent {
  event_date: string
  ratio: number | null
}

type RawSplit = { date?: Date | string | number; numerator?: number; denominator?: number }

/**
 * Pure mapping of yahoo's split events. Ratio is stored as new shares per old
 * share: a 1-becomes-2 split is 2.0, a 1:10 reverse split is 0.1. Getting this
 * inverted would silently corrupt any future cost-basis adjustment.
 */
export function mapSplits(events: RawSplit[] | undefined): SplitEvent[] {
  if (!events) return []
  return events
    .map((e) => {
      const num = n(e.numerator)
      const den = n(e.denominator)
      const day = toDay(e.date)
      if (!day) return null
      return { event_date: day, ratio: num != null && den ? num / den : null }
    })
    .filter((x): x is SplitEvent => x !== null)
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
}

/** Split events for a ticker since `since` (default: 5 years back). */
export async function fetchSplits(ticker: string, since?: Date): Promise<SplitEvent[]> {
  const symbol = normalizeTicker(ticker)
  const from = since ?? new Date(Date.now() - 5 * 365 * 24 * 3_600_000)
  try {
    const raw = await withRetry(() =>
      yf.chart(symbol, { period1: from, interval: '1d', events: 'split' },
               { validateResult: false })) as { events?: { splits?: RawSplit[] } }
    return mapSplits(raw.events?.splits)
  } catch (err) {
    console.error(`[market] splits ${symbol}:`, err instanceof Error ? err.message : err)
    return []
  }
}
