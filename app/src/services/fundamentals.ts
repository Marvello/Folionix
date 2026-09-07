import 'dotenv/config'
import {
  loadPortfolio, getWatchlist,
  saveKeyStats, saveFinancials, saveCorporateActions,
} from '../db/db.js'
import { fetchKeyStats, fetchFinancials, fetchSplits } from '../providers/market.js'
import { normalizeTicker } from '../../../lib/format.js'
import { mapPool } from '../utils/mapPool.js'

// ── FUNDAMENTALS REFRESH ──

const CONCURRENCY = Math.max(1, Number(process.env.PROVIDER_CONCURRENCY) || 4)

export interface RefreshResult {
  ticker: string
  keyStats: boolean
  periods: number
  splits: number
  error?: string
}

async function refreshOne(ticker: string): Promise<RefreshResult> {
  const result: RefreshResult = { ticker, keyStats: false, periods: 0, splits: 0 }
  try {
    const [stats, periods, splits] = await Promise.all([
      fetchKeyStats(ticker), fetchFinancials(ticker), fetchSplits(ticker),
    ])
    if (stats) { await saveKeyStats(ticker, stats); result.keyStats = true }
    if (periods.length > 0) { await saveFinancials(ticker, periods); result.periods = periods.length }
    if (splits.length > 0) {
      await saveCorporateActions(ticker, 'SPLIT',
        splits.map((s) => ({ event_date: s.event_date, ratio: s.ratio })), 'yahoo')
      result.splits = splits.length
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  return result
}

/**
 * Refresh fundamentals for held + watchlist tickers (or an explicit list).
 * Per-ticker failures are recorded and skipped, never fatal, the same
 * contract runPriceRefresh honours.
 */
export async function refreshFundamentals(tickers?: string[]): Promise<RefreshResult[]> {
  const [portfolio, watch] = await Promise.all([loadPortfolio(), getWatchlist()])
  const all = Array.from(new Set([
    ...Object.keys(portfolio),
    ...watch.map((w: { ticker: string }) => w.ticker),
  ].map(normalizeTicker)))
  const wanted = tickers && tickers.length > 0
    ? all.filter((t) => tickers.map(normalizeTicker).includes(t))
    : all

  const settled = await mapPool(wanted, CONCURRENCY, refreshOne)
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { ticker: wanted[i]!, keyStats: false, periods: 0, splits: 0, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
  )
}

// ── CLI entry ──

if (process.argv[1]?.endsWith('fundamentals.ts') || process.argv[1]?.endsWith('fundamentals.js')) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  refreshFundamentals(args.length > 0 ? args : undefined)
    .then((rs) => {
      for (const r of rs) {
        console.log(`[fundamentals] ${r.ticker}: stats=${r.keyStats} periods=${r.periods} splits=${r.splits}${r.error ? ` error=${r.error}` : ''}`)
      }
      const ok = rs.filter((r) => !r.error).length
      console.log(`[fundamentals] ${ok}/${rs.length} refreshed`)
    })
    .catch((err: unknown) => {
      console.error('[fundamentals]', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
