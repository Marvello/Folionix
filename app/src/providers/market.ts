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
