import 'dotenv/config'
import { aggregatePortfolio, type PortfolioAggregate } from '../../../lib/aggregate'
import { displayTicker, fmtIdr, wibDateOffset } from '../../../lib/format'
import type { LlmAnalysisRow, NewsSentimentRow, RecommendationAccuracyRow, StockSnapshotRow } from '../../../lib/types'
import {
  getAllPositions, getLatestSnapshots, getSnapshotBefore,
  getGoldPurchases, getLatestGoldPrices, getGoldPriceBefore,
  getBondHoldings, getBondCouponPayments,
  getFundPurchases, getLatestFundNavs, getFundNavBefore,
  getForexRatesToIdr, getStockDividends, getFundDistributions, getAccountCharges,
  getAnalysesBetween, getRecommendationAccuracy, getSentimentsBetween, getSnapshotPricesSince,
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
  lines.push('_Week-ago figures reprice current holdings at week-ago prices; buys/sells during the week are not backed out._', '')
  return lines.join('\n')
}

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

export function buildHandoverDoc(args: {
  weekStart: string
  weekEnd: string
  model: string
  numbersSection: string
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
        '| Ticker | Rec | Analysed | Price@Rec | Price+Nd | Move | Correct |',
        '|---|---|---|---:|---:|---:|---|',
        ...args.accuracy.map(a =>
          `| ${displayTicker(a.ticker)} | ${a.recommendation} | ${(a.analysed_at ?? '').slice(0, 10)} | ${a.price_at_rec ?? 'N/A'} | ${a.price_after ?? 'N/A'} | ${pct(a.actual_change_pct)} | ${a.correct == null ? 'N/A' : a.correct ? 'yes' : 'no'} |`),
      ]
  return [
    `# Folionix Analysis Handover — week ${args.weekStart} → ${args.weekEnd}`,
    '',
    '> **Instructions for the reviewing LLM:** You are auditing a small self-hosted',
    '> stock-analysis system that runs a local model with limited context. Using the',
    '> raw data below, assess the quality of last week\'s recommendations and propose',
    '> concrete improvements: (1) additional data sources worth ingesting, (2) specific',
    '> prompt changes (structure, framing, output format), (3) recommendation-policy',
    '> fixes (thresholds, dedup, timing). Be specific and actionable; assume changes',
    '> must run on a local LLM with ~4k output tokens.',
    '',
    '## System description',
    '',
    `- Analysis model: \`${args.model}\` via Vercel AI SDK (Ollama/LiteLLM), temperature 0.3, max ~4096 output tokens.`,
    '- Per-ticker prompt contains: IDX market-session label (WIB), price block (current, day change, volume, 52w range), investor position (lots, avg price, P&L) for held stocks, fundamentals (P/E, P/B, dividend yield, market cap) on FULL/DEEP depth, a TECHNICALS block computed from snapshot history (SMA20/50, RSI14, 1W momentum, volume vs 20d avg, IHSG relative strength), optional news-sentiment summary (RSS headlines summarized by the same LLM), and a required Telegram-HTML output template ending in a mandatory `REKOMENDASI: <keyword>` line.',
    '- Held positions get action sizing vs a Rp 1,000,000 materiality threshold but must still state a market view; watchlist tickers are asked for a pure entry signal (BUY / MONITOR / HOLD) with no threshold.',
    '- Recommendation extracted from the REKOMENDASI line (fallback: keyword scan): AVERAGE DOWN, TAKE PROFIT, CUT LOSS, HOLD, MONITOR, BUY, TRIM.',
    '- Data sources today: yahoo-finance2 (prices + fundamentals), Google News RSS (sentiment), own snapshot history (technicals), Finnhub (optional fallback, USD). No broker flow, no order-book data, no sector benchmarks.',
    '- Accuracy scoring: one rec per ticker per WIB day (the last); BUY-ish correct when price rises after N days, SELL-ish when it falls, HOLD-ish when |move| < 5%.',
    '',
    args.numbersSection,
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
    '',
  ].join('\n')
}

// ── LLM SELF-CRITIQUE ───────────────────────────────────────────────────────

async function buildSelfCritique(
  numbersSection: string,
  ledgerSection: string,
  newsSection: string,
): Promise<string> {
  const system = 'You are reviewing the weekly output of an automated IDX stock-analysis system. Be candid and concrete.'
  const prompt = [
    'Below are this week\'s portfolio numbers, the recommendations the system issued with outcomes, and the news sentiment the system fed into those recommendations.',
    '',
    numbersSection,
    ledgerSection,
    newsSection,
    'Write a short self-review in plain markdown (max 200 words):',
    '1. What the recommendations got right or wrong this week (cite tickers), and whether news sentiment aligned with outcomes — call out tickers where they diverged.',
    '2. One pattern to watch next week.',
    '3. One concrete improvement to the analysis system (data or prompt).',
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

  // ── Week-ago aggregate: same holdings, week-ago prices ──
  let weekAgoAgg: PortfolioAggregate | null = null
  const stockChanges: StockWeekChange[] = []
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

  // ── Assemble sections ──
  const numbersSection = buildNumbersSection(current, weekAgoAgg, stockChanges)
  const ledgerSection = buildLedgerSection(ledger, accuracy, failures)
  const newsSection = buildNewsSection(sentiments)
  const critiqueSection = await buildSelfCritique(numbersSection, ledgerSection, newsSection)

  const model = process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown'
  const reportMd = [
    `# Folionix Week Review — ${weekStart} → ${weekEnd}`,
    '',
    numbersSection,
    ledgerSection,
    newsSection,
    critiqueSection,
  ].join('\n')

  const lastWithOutput = [...weekAnalyses].reverse().find(a => a.raw_output)
  const handoverMd = buildHandoverDoc({
    weekStart, weekEnd, model,
    numbersSection, ledgerSection, newsSection, accuracy,
    sampleRawOutput: lastWithOutput?.raw_output ?? null,
    failures,
  })

  const scored = accuracy.filter(a => a.correct != null)
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
