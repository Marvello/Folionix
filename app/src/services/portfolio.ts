import 'dotenv/config'
import {
  loadPortfolio, saveSnapshot, getLatestSnapshot, saveAnalysis, getLatestAnalysis,
  getWatchlist, getSnapshotSeries, getSnapshotPrice,
} from '../db/db'
import { computeIndicators, toDailySeries, type Indicators } from '../ai/indicators'
import { fetchStock } from '../providers/market'
import { fetchNewsForTicker, summarizeNewsWithLlm } from './news'
import { callLlm, extractRecommendation, cleanForTelegram } from '../ai/llm'
import { buildPrompt } from '../ai/prompts'
import { sendTelegram } from '../telegram/client'
import { evaluateAlert } from '../telegram/alerts'
import { normalizeTicker, WIB } from '../../../lib/format'

type Depth = 'LIGHT' | 'FULL' | 'DEEP'

const REC_STABILITY_PCT = Math.max(0, Number(process.env.REC_STABILITY_PCT) || 2) / 100
export type AlertMode = 'spike' | 'dedup' | 'silent'

const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== 'false'
const NO_LLM = process.argv.includes('--no-llm')
const NO_TELEGRAM = process.argv.includes('--no-telegram') || !SEND_TELEGRAM

// Cap concurrent provider fetches so a large portfolio can't burst Yahoo/Finnhub
// and trip their rate limits. Preserves the PromiseSettledResult shape callers
// already log over.
const FETCH_CONCURRENCY = Math.max(1, Number(process.env.PROVIDER_CONCURRENCY) || 4)

async function mapPool<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      try { out[idx] = { status: 'fulfilled', value: await fn(items[idx]) } }
      catch (reason) { out[idx] = { status: 'rejected', reason } }
    }
  })
  await Promise.all(workers)
  return out
}

export async function runPriceRefresh(tickers?: string[]): Promise<void> {
  const portfolio = await loadPortfolio()
  const wl = await getWatchlist()

  const allTickers: Array<{ ticker: string; avgPrice: number; lots: number; notes: string | null }> = []

  for (const [t, pos] of Object.entries(portfolio)) {
    if (!tickers || tickers.includes(t)) {
      allTickers.push({ ticker: t, avgPrice: pos.avg_price, lots: pos.lots, notes: pos.notes })
    }
  }
  for (const w of wl) {
    if (!tickers || tickers.includes(w.ticker)) {
      allTickers.push({ ticker: w.ticker, avgPrice: 0, lots: 0, notes: w.notes })
    }
  }

  // Concurrency-capped fan-out for price fetches
  const results = await mapPool(allTickers, FETCH_CONCURRENCY, async ({ ticker, avgPrice, lots, notes }) => {
    try {
      const snap = await fetchStock(ticker, avgPrice, lots, notes, true)
      // Don't persist a price-less snapshot: a transient provider gap would
      // otherwise overwrite the last good price with a null row (dashboard
      // N/A). Skipping keeps the previous snapshot until a real price returns.
      if (snap.current_price == null) {
        console.warn(`[prices] ${ticker}: no price from any provider — skipped`)
        return
      }
      await saveSnapshot(snap)
      console.log(`[prices] ${ticker}: ${snap.current_price}`)
    } catch (err) {
      throw new Error(`${ticker}: ${String(err)}`, { cause: err })
    }
  })
  for (const r of results) {
    if (r.status === 'rejected') console.error('[prices] fetch failed:', r.reason)
  }
}

/** Daily technical indicators from our own snapshot history (+ IHSG relative
 *  strength when ^JKSE snapshots exist). Best-effort — null on any failure. */
export async function computeTickerIndicators(jk: string): Promise<Indicators | null> {
  try {
    const [series, idxSeries] = await Promise.all([
      getSnapshotSeries(jk),
      jk === '^JKSE' ? Promise.resolve([]) : getSnapshotSeries('^JKSE'),
    ])
    const daily = toDailySeries(series)
    const idxDaily = toDailySeries(idxSeries)
    return computeIndicators(daily, idxDaily.length > 0 ? idxDaily : undefined)
  } catch (err) {
    console.error(`[indicators] ${jk} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

async function analyzeOneTicker(
  ticker: string,
  avgPrice: number,
  lots: number,
  notes: string | null,
  depth: Depth,
  alerts: AlertMode = 'dedup',
): Promise<void> {
  const jk = normalizeTicker(ticker)
  const snap = await fetchStock(ticker, avgPrice, lots, notes)
  const snapshotId = await saveSnapshot(snap)

  if (NO_LLM) return

  const prevAnalysis = await getLatestAnalysis(jk)

  // Skip re-analysis if same WIB trading day and price hasn't moved enough
  if (prevAnalysis?.analysed_at && snap.current_price != null) {
    const prevWib = new Date(prevAnalysis.analysed_at).toLocaleDateString('id-ID', { timeZone: WIB })
    const nowWib = new Date().toLocaleDateString('id-ID', { timeZone: WIB })
    if (prevWib === nowWib) {
      const prevPrice = await getSnapshotPrice(prevAnalysis.snapshot_id)
      if (prevPrice != null && prevPrice > 0) {
        const delta = Math.abs(snap.current_price - prevPrice) / prevPrice
        if (delta < REC_STABILITY_PCT) {
          console.log(`[analysis] ${jk}: skipped (same day, Δ ${(delta * 100).toFixed(1)}% < ${(REC_STABILITY_PCT * 100).toFixed(0)}%)`)
          return
        }
      }
    }
  }

  const [articles, indicators] = await Promise.all([
    fetchNewsForTicker(jk, depth),
    computeTickerIndicators(jk),
  ])
  const newsSentiment = articles.length > 0
    ? await summarizeNewsWithLlm(articles, jk, depth)
    : undefined

  const prompt = buildPrompt(snap, null, depth, newsSentiment, undefined, indicators)
  const raw = await callLlm(prompt)
  const cleanHtml = cleanForTelegram(raw)
  const recommendation = extractRecommendation(raw)

  const alertEval = evaluateAlert(prevAnalysis, recommendation, new Date())
  // 'silent': never alert (scheduled baselines). 'spike' (signal-triggered)
  // and 'dedup' (manual runs) both alert only when the recommendation changed
  // or the WIB day rolled over — repeating an unchanged verdict is noise.
  const sent = !NO_TELEGRAM && alerts !== 'silent' && !alertEval.isSame

  if (sent) {
    const header = `<b>${jk.replace('.JK', '')}</b> — ${recommendation}\n\n`
    await sendTelegram(header + cleanHtml)
  }

  await saveAnalysis(snapshotId, jk, process.env.LLM_MODEL ?? 'unknown', raw, cleanHtml, recommendation, sent, alertEval.isSame)
}

export async function runPortfolioPipeline(tickers?: string[], depth: Depth = 'FULL', alerts: AlertMode = 'dedup'): Promise<void> {
  const portfolio = await loadPortfolio()
  const entries = tickers
    ? Object.entries(portfolio).filter(([t]) => tickers.includes(t))
    : Object.entries(portfolio)

  const batch = entries.map(([ticker, pos]) =>
    ({ ticker, avgPrice: pos.avg_price, lots: pos.lots, notes: pos.notes }))

  // Explicit tickers not held (e.g. a signaled watchlist ticker) analyze as watch-only
  if (tickers) {
    const missing = tickers.filter(t => !(t in portfolio))
    if (missing.length > 0) {
      const wl = await getWatchlist()
      for (const w of wl) {
        if (missing.includes(w.ticker)) {
          batch.push({ ticker: w.ticker, avgPrice: 0, lots: 0, notes: w.notes })
        }
      }
    }
  }

  // Concurrency-capped fan-out for ticker analysis
  const results = await mapPool(batch, FETCH_CONCURRENCY, ({ ticker, avgPrice, lots, notes }) =>
    analyzeOneTicker(ticker, avgPrice, lots, notes, depth, alerts).catch((err) => {
      throw new Error(`${ticker}: ${String(err)}`)
    }),
  )
  for (const r of results) {
    if (r.status === 'rejected') console.error('[portfolio] ticker failed:', r.reason)
  }
}

export async function runWatchlistPipeline(alerts: AlertMode = 'dedup'): Promise<void> {
  const wl = await getWatchlist()
  // Concurrency-capped fan-out for ticker analysis
  const results = await mapPool(wl, FETCH_CONCURRENCY, entry =>
    analyzeOneTicker(entry.ticker, 0, 0, entry.notes, 'LIGHT', alerts).catch((err) => {
      throw new Error(`${entry.ticker}: ${String(err)}`)
    }),
  )
  for (const r of results) {
    if (r.status === 'rejected') console.error('[watchlist] ticker failed:', r.reason)
  }
}

// ── CLI entry ──
if (process.argv[1]?.endsWith('portfolio.ts') || process.argv[1]?.endsWith('portfolio.js')) {
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))

  if (process.argv.includes('--prices')) {
    runPriceRefresh(positional.length ? positional : undefined).catch(console.error)
  } else if (process.argv.includes('--watchlist')) {
    runWatchlistPipeline().catch(console.error)
  } else {
    runPortfolioPipeline(positional.length ? positional : undefined).catch(console.error)
  }
}
