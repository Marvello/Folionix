import 'dotenv/config'
import { createPool } from '@marvello/common-tech/client'
import pg from 'pg'
import type {
  StockSnapshotRow, PositionRow, GoldPurchaseRow,
  FundCatalogRow, FundSnapshotRow, FundHoldingRow, FundPurchaseRow,
  BondHoldingRow, BondCouponScheduleRow, BondCouponPaymentRow,
  WatchlistRow, LlmAnalysisRow, StockTransactionRow, DividendScheduleRow,
  WeeklyReviewRow, RecommendationAccuracyRow, NewsSentimentRow,
  StockDividendRow, FundDistributionRow, AccountChargeRow,
  AnalysisJobRow, PersonaAnalysisRow,
} from '../../../lib/types.js'

pg.types.setTypeParser(1082, (v: string) => v)
pg.types.setTypeParser(1114, (v: string) => v)
pg.types.setTypeParser(1184, (v: string) => v)

let _pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL required')
    _pool = createPool({ connectionString: url, max: 10 })
  }
  return _pool
}

function q(text: string, params?: unknown[]) {
  return getPool().query(text, params)
}

// ── PORTFOLIO ──

export async function upsertPosition(
  ticker: string, avgPrice: number, lots: number, notes: string | null,
): Promise<void> {
  await q(
    `INSERT INTO portfolio_positions (ticker, avg_price, lots, notes, active, updated_at)
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT (ticker) DO UPDATE SET avg_price = $2, lots = $3, notes = $4, active = true, updated_at = now()`,
    [ticker, avgPrice, lots, notes],
  )
}

export async function deactivatePosition(ticker: string): Promise<void> {
  await q(
    `UPDATE portfolio_positions SET active = false, updated_at = now() WHERE ticker = $1`,
    [ticker],
  )
}

export async function getAllPositions(): Promise<PositionRow[]> {
  const { rows } = await q(
    `SELECT * FROM portfolio_positions WHERE active = true ORDER BY ticker`,
  )
  return rows
}

export async function loadPortfolio(): Promise<Record<string, { avg_price: number; lots: number; notes: string | null }>> {
  const positions = await getAllPositions()
  return Object.fromEntries(positions.map(p => [p.ticker, { avg_price: p.avg_price, lots: p.lots, notes: p.notes }]))
}

export async function addStockTransaction(
  t: Omit<StockTransactionRow, 'id' | 'created_at'>,
): Promise<void> {
  await q(
    `INSERT INTO stock_transactions (ticker, side, lots, price, fee, txn_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [t.ticker, t.side, t.lots, t.price, t.fee ?? 0, t.txn_at, t.notes ?? ''],
  )
}

export async function getStockTransactions(ticker?: string): Promise<StockTransactionRow[]> {
  if (ticker) {
    const { rows } = await q(
      `SELECT * FROM stock_transactions WHERE ticker = $1 ORDER BY txn_at ASC`,
      [ticker],
    )
    return rows
  }
  const { rows } = await q(`SELECT * FROM stock_transactions ORDER BY txn_at ASC`)
  return rows
}

// ── SNAPSHOTS ──

export type SnapshotInput = Omit<StockSnapshotRow, 'id' | 'fetched_at'>

export async function saveSnapshot(data: SnapshotInput): Promise<number> {
  // Callers may hand back a full DB row (fetchStock's cache-hit path returns
  // one); drop server-owned columns so we never emit a duplicate target.
  const { id: _id, fetched_at: _fetched, ...fields } =
    data as SnapshotInput & { id?: unknown; fetched_at?: unknown }
  const cols = Object.keys(fields)
  const vals = Object.values(fields)
  cols.push('fetched_at')
  vals.push(new Date().toISOString())
  const placeholders = vals.map((_, i) => `$${i + 1}`)
  const { rows } = await q(
    `INSERT INTO stock_snapshots (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    vals,
  )
  return rows[0].id
}

export async function getSnapshotPrice(snapshotId: number): Promise<number | null> {
  const { rows } = await q(
    `SELECT current_price FROM stock_snapshots WHERE id = $1`,
    [snapshotId],
  )
  return rows[0]?.current_price ?? null
}

export async function getLatestSnapshot(ticker: string): Promise<StockSnapshotRow | null> {
  const { rows } = await q(
    `SELECT * FROM latest_snapshots WHERE ticker = $1`,
    [ticker],
  )
  return rows[0] ?? null
}

export async function getSnapshotBefore(ticker: string, cutoff: Date): Promise<StockSnapshotRow | null> {
  const { rows } = await q(
    `SELECT * FROM stock_snapshots
     WHERE ticker = $1 AND fetched_at <= $2
     ORDER BY fetched_at DESC LIMIT 1`,
    [ticker, cutoff.toISOString()],
  )
  return rows[0] ?? null
}

export async function getSnapshotSeries(
  ticker: string,
  days = 90,
): Promise<Array<{ current_price: number | null; volume: number | null; fetched_at: string }>> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  // Take the NEWEST rows under the cap, then restore ascending order. Ordering
  // ASC with LIMIT would keep the OLDEST 20k and silently drop the recent data
  // indicators actually need if a ticker ever exceeds the cap.
  const { rows } = await q(
    `SELECT current_price, volume, fetched_at FROM stock_snapshots
     WHERE ticker = $1 AND fetched_at >= $2
     ORDER BY fetched_at DESC LIMIT 20000`,
    [ticker, cutoff],
  )
  return rows.reverse()
}

export async function getSnapshotPricesSince(
  tickers: string[],
  since: Date,
): Promise<Array<{ ticker: string; current_price: number | null; fetched_at: string }>> {
  const uniq = [...new Set(tickers.map(t => t.toUpperCase()))]
  if (uniq.length === 0) return []
  const { rows } = await q(
    `SELECT ticker, current_price, fetched_at FROM stock_snapshots
     WHERE ticker = ANY($1) AND fetched_at >= $2
     ORDER BY fetched_at ASC, id ASC`,
    [uniq, since.toISOString()],
  )
  return rows
}

// ── ANALYSES ──

export async function saveAnalysis(
  snapshotId: number,
  ticker: string,
  model: string,
  rawOutput: string,
  cleanHtml: string,
  recommendation: string,
  sent: boolean,
  skippedSame: boolean,
): Promise<number> {
  const { rows } = await q(
    `INSERT INTO llm_analyses (snapshot_id, ticker, model, raw_output, clean_html, recommendation, sent_telegram, skipped_same, analysed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [snapshotId, ticker, model, rawOutput, cleanHtml, recommendation, sent, skippedSame],
  )
  return rows[0].id
}

export async function getLatestAnalysis(ticker: string): Promise<LlmAnalysisRow | null> {
  const { rows } = await q(
    `SELECT * FROM llm_analyses WHERE ticker = $1 ORDER BY analysed_at DESC LIMIT 1`,
    [ticker],
  )
  return rows[0] ?? null
}

// ── GOLD ──

export async function saveGoldSnapshot(
  venue: string,
  opts: { buy: number; sell: number; mid?: number | null; priceAt?: string | null },
): Promise<void> {
  await q(
    `INSERT INTO gold_snapshots (venue, buy_price, sell_price, mid_price, price_at, fetched_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [venue, opts.buy, opts.sell, opts.mid ?? null, opts.priceAt ?? null],
  )
}

export async function getGoldPurchases(): Promise<GoldPurchaseRow[]> {
  const { rows } = await q(
    `SELECT * FROM gold_purchases WHERE active = true ORDER BY purchased_at DESC`,
  )
  return rows
}

export async function addGoldPurchase(
  venue: string, grams: number, buyPrice: number, notes: string | null,
): Promise<number> {
  const { rows } = await q(
    `INSERT INTO gold_purchases (venue, grams, buy_price_per_gram, notes, active, purchased_at, updated_at)
     VALUES ($1, $2, $3, $4, true, now(), now()) RETURNING id`,
    [venue, grams, buyPrice, notes],
  )
  return rows[0].id
}

export async function deactivateGoldPurchase(id: number): Promise<void> {
  await q(
    `UPDATE gold_purchases SET active = false, updated_at = now() WHERE id = $1`,
    [id],
  )
}

// ── FUNDS ──

export async function upsertFundCatalog(records: FundCatalogRow[]): Promise<void> {
  if (records.length === 0) return
  const now = new Date().toISOString()
  for (const r of records) {
    await q(
      `INSERT INTO fund_catalog (code, name, slug, fund_type, category, investment_manager, currency, active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (code) DO UPDATE SET
         name = $2, slug = $3, fund_type = $4, category = $5, investment_manager = $6,
         currency = $7, active = $8, updated_at = $9`,
      [r.code, r.name, r.slug ?? null, r.fund_type ?? null, r.category ?? null,
       r.investment_manager ?? null, r.currency ?? 'IDR', r.active ?? true, now],
    )
  }
}

export type FundSnapshotMetrics = Pick<FundSnapshotRow,
  'aum' | 'expense_ratio' | 'cagr' | 'ret_1m' | 'ret_3m' | 'ret_ytd' | 'ret_1y'>

export async function saveFundSnapshot(
  fundCode: string, nav: number, navAt: string, metrics: FundSnapshotMetrics = {},
): Promise<void> {
  await q(
    `INSERT INTO fund_snapshots (fund_code, nav, nav_at, aum, expense_ratio, cagr, ret_1m, ret_3m, ret_ytd, ret_1y, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (fund_code, nav_at) DO UPDATE SET
       nav = $2, aum = $4, expense_ratio = $5, cagr = $6, ret_1m = $7, ret_3m = $8, ret_ytd = $9, ret_1y = $10, fetched_at = now()`,
    [fundCode, nav, navAt,
     metrics.aum ?? null, metrics.expense_ratio ?? null, metrics.cagr ?? null,
     metrics.ret_1m ?? null, metrics.ret_3m ?? null, metrics.ret_ytd ?? null, metrics.ret_1y ?? null],
  )
}

export async function getHeldFundSlugs(): Promise<Array<{ fund_code: string; slug: string }>> {
  const { rows } = await q(
    `SELECT DISTINCT fp.fund_code, fc.slug
     FROM fund_purchases fp
     JOIN fund_catalog fc ON fc.code = fp.fund_code
     WHERE fp.active = true AND fc.slug IS NOT NULL`,
  )
  return rows
}

export async function replaceFundHoldings(fundCode: string, holdings: FundHoldingRow[]): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM fund_holdings WHERE fund_code = $1`, [fundCode])
    for (const r of holdings) {
      await client.query(
        `INSERT INTO fund_holdings (fund_code, label, ticker, percentage, as_of)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.fund_code, r.label, r.ticker ?? null, r.percentage ?? null, r.as_of],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getFundPurchases(): Promise<FundPurchaseRow[]> {
  const { rows } = await q(
    `SELECT * FROM fund_purchases WHERE active = true ORDER BY purchased_at DESC`,
  )
  return rows
}

// ── BONDS ──

export async function getBondHoldings(): Promise<BondHoldingRow[]> {
  const { rows } = await q(
    `SELECT * FROM bond_holdings WHERE active = true ORDER BY maturity_date`,
  )
  return rows
}

export async function saveBondCouponPayment(
  bondId: number, paidAt: string, amount: number, notes: string | null = null,
): Promise<void> {
  await q(
    `INSERT INTO bond_coupon_payments (bond_id, paid_at, amount, notes)
     VALUES ($1, $2, $3, $4)`,
    [bondId, paidAt, amount, notes],
  )
}

export async function upsertBondCouponSchedule(
  bondId: number, seriesCode: string,
  schedules: Array<{ payment_date: string; status?: string | null }>,
): Promise<void> {
  if (schedules.length === 0) return
  const scrapedAt = new Date().toISOString()
  const unique = [...new Map(schedules.map(s => [s.payment_date, s])).values()]
  for (const s of unique) {
    await q(
      `INSERT INTO bond_coupon_schedule (bond_holding_id, series_code, distribution_date, status, scraped_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bond_holding_id, distribution_date) DO UPDATE SET
         series_code = $2, status = $4, scraped_at = $5`,
      [bondId, seriesCode, s.payment_date, s.status ?? null, scrapedAt],
    )
  }
}

export async function getBondCouponScheduleDates(): Promise<Array<{ bond_holding_id: number; distribution_date: string }>> {
  const { rows } = await q(
    `SELECT bond_holding_id, distribution_date FROM bond_coupon_schedule`,
  )
  return rows
}

export async function getBondCouponPaymentRows(): Promise<Array<{ bond_holding_id: number; paid_at: string; amount: number | null }>> {
  const { rows } = await q(
    `SELECT bond_holding_id, paid_at, amount FROM bond_coupon_payments`,
  )
  return rows
}

export async function getBondScheduleForDate(date: string): Promise<BondCouponScheduleRow[]> {
  const { rows } = await q(
    `SELECT * FROM bond_coupon_schedule WHERE distribution_date = $1`,
    [date],
  )
  return rows
}

// ── DIVIDEND SCHEDULE ──

export async function upsertDividendSchedule(row: {
  ticker: string; cum_date: string | null; ex_date: string; recording_date: string | null;
  pay_date: string | null; amount_per_share: number | null; amount_estimated: boolean; currency: string | null
}): Promise<void> {
  const { rows: existing } = await q(
    `SELECT source FROM dividend_schedule WHERE ticker = $1 AND ex_date = $2`,
    [row.ticker, row.ex_date],
  )
  if (existing[0]?.source === 'manual') return

  await q(
    `INSERT INTO dividend_schedule (ticker, cum_date, ex_date, recording_date, pay_date, amount_per_share, amount_estimated, currency, source, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'idx', now())
     ON CONFLICT (ticker, ex_date) DO UPDATE SET
       cum_date = $2, recording_date = $4, pay_date = $5, amount_per_share = $6,
       amount_estimated = $7, currency = $8, source = 'idx', synced_at = now()`,
    [row.ticker, row.cum_date, row.ex_date, row.recording_date, row.pay_date,
     row.amount_per_share, row.amount_estimated, row.currency],
  )
}

export async function getDividendScheduleForExDate(date: string): Promise<DividendScheduleRow[]> {
  const { rows } = await q(`SELECT * FROM dividend_schedule WHERE ex_date = $1`, [date])
  return rows
}

export async function getDividendScheduleForPayDate(date: string): Promise<DividendScheduleRow[]> {
  const { rows } = await q(`SELECT * FROM dividend_schedule WHERE pay_date = $1`, [date])
  return rows
}

// ── WATCHLIST ──

export async function getWatchlist(): Promise<WatchlistRow[]> {
  const { rows } = await q(`SELECT * FROM watchlist ORDER BY ticker`)
  return rows
}

export async function addWatchlistTicker(ticker: string, notes: string | null, kind: 'user' | 'ai_suggested' = 'user'): Promise<void> {
  await q(
    `INSERT INTO watchlist (ticker, notes, kind) VALUES ($1, $2, $3)
     ON CONFLICT (ticker) DO UPDATE SET notes = $2, kind = $3`,
    [ticker, notes, kind],
  )
}

export async function removeWatchlistTicker(ticker: string): Promise<void> {
  await q(`DELETE FROM watchlist WHERE ticker = $1`, [ticker])
}

// ── NEWS CACHE ──

export async function getCachedSentiment(
  ticker: string,
  depth: string,
  maxAgeHours = 12,
): Promise<{ summary: string; score: number } | null> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString()
  const { rows } = await q(
    `SELECT raw_output, score FROM news_sentiments
     WHERE ticker = $1 AND depth = $2 AND summarized_at >= $3
     ORDER BY summarized_at DESC LIMIT 1`,
    [ticker, depth, cutoff],
  )
  const row = rows[0]
  if (!row?.raw_output) return null
  return { summary: row.raw_output, score: Number(row.score) || 0 }
}

export async function saveSentiment(
  ticker: string,
  depth: string,
  rawOutput: string,
  score: number,
  extra?: { themes?: string | null; catalyst?: string | null; risk?: string | null },
): Promise<void> {
  try {
    await q(
      `INSERT INTO news_sentiments (ticker, depth, raw_output, score, themes, catalyst, risk, summarized_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [ticker, depth, rawOutput, score,
       extra?.themes ?? null, extra?.catalyst ?? null, extra?.risk ?? null],
    )
  } catch (err) {
    console.warn('[db] saveSentiment failed:', (err as Error).message)
    throw err
  }
}

export async function getLatestSentiment(
  ticker: string,
  maxAgeHours = 48,
): Promise<NewsSentimentRow | null> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString()
  const { rows } = await q(
    `SELECT id, ticker, summarized_at, depth, score, themes, catalyst, risk
     FROM news_sentiments
     WHERE ticker = $1 AND summarized_at >= $2
     ORDER BY summarized_at DESC LIMIT 1`,
    [ticker, cutoff],
  )
  return rows[0] ?? null
}

export async function getSentimentsBetween(from: Date, to: Date): Promise<NewsSentimentRow[]> {
  const { rows } = await q(
    `SELECT id, ticker, summarized_at, depth, score, themes, catalyst, risk
     FROM news_sentiments
     WHERE summarized_at >= $1 AND summarized_at <= $2
     ORDER BY summarized_at DESC`,
    [from.toISOString(), to.toISOString()],
  )
  return rows
}

export async function getCachedNewsUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
  const { rows } = await q(
    `SELECT url FROM news_cache WHERE url = ANY($1)`,
    [urls],
  )
  return new Set(rows.map((r: { url: string }) => r.url))
}

export async function saveNewsArticles(
  ticker: string,
  source: string,
  articles: Array<{ headline: string; url: string; publishedAt?: string; summary?: string }>,
): Promise<void> {
  if (articles.length === 0) return
  for (const a of articles) {
    try {
      await q(
        `INSERT INTO news_cache (ticker, source, headline, url, summary, published_at, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (url) DO NOTHING`,
        [ticker, source, a.headline.slice(0, 500), a.url.slice(0, 500),
         a.summary ?? null, a.publishedAt ?? null],
      )
    } catch (err) {
      console.error('[db] saveNewsArticles failed:', (err as Error).message)
      throw err
    }
  }
}

// ── WEEKLY REVIEW ──

export async function getLatestSnapshots(): Promise<StockSnapshotRow[]> {
  const { rows } = await q(`SELECT * FROM latest_snapshots`)
  return rows
}

export async function getLatestGoldPrices(): Promise<Array<{ venue: string; sell_price: number | null }>> {
  const { rows } = await q(`SELECT venue, sell_price FROM latest_gold_prices`)
  return rows
}

export async function getLatestFundNavs(): Promise<Array<{ fund_code: string; nav: number | null }>> {
  const { rows } = await q(`SELECT fund_code, nav FROM latest_fund_navs`)
  return rows
}

export async function getForexRatesToIdr(): Promise<Map<string, number>> {
  const { rows } = await q(
    `SELECT base_currency, rate FROM latest_forex_rates WHERE quote_currency = 'IDR'`,
  )
  return new Map(rows.map((r: { base_currency: string; rate: number }) => [r.base_currency, r.rate]))
}

export async function getBondCouponPayments(): Promise<Array<{ amount: number | null }>> {
  const { rows } = await q(`SELECT amount FROM bond_coupon_payments`)
  return rows
}

export async function getStockDividends(): Promise<StockDividendRow[]> {
  const { rows } = await q(`SELECT * FROM stock_dividends`)
  return rows
}

export async function getFundDistributions(): Promise<FundDistributionRow[]> {
  const { rows } = await q(`SELECT * FROM fund_distributions`)
  return rows
}

export async function getAccountCharges(): Promise<AccountChargeRow[]> {
  const { rows } = await q(`SELECT * FROM account_charges`)
  return rows
}

export async function getAnalysesBetween(from: Date, to: Date): Promise<LlmAnalysisRow[]> {
  const { rows } = await q(
    `SELECT * FROM llm_analyses
     WHERE analysed_at >= $1 AND analysed_at <= $2
     ORDER BY analysed_at ASC`,
    [from.toISOString(), to.toISOString()],
  )
  return rows
}

export async function getRecommendationAccuracy(daysAfter = 3): Promise<RecommendationAccuracyRow[]> {
  const { rows } = await q(
    `SELECT * FROM recommendation_accuracy($1)`,
    [daysAfter],
  )
  return rows
}

export async function getGoldPriceBefore(venue: string, cutoff: Date): Promise<number | null> {
  const { rows } = await q(
    `SELECT sell_price FROM gold_snapshots
     WHERE venue = $1 AND fetched_at <= $2
     ORDER BY fetched_at DESC LIMIT 1`,
    [venue, cutoff.toISOString()],
  )
  return rows[0]?.sell_price ?? null
}

export async function getFundNavBefore(fundCode: string, cutoff: Date): Promise<number | null> {
  const { rows } = await q(
    `SELECT nav FROM fund_snapshots
     WHERE fund_code = $1 AND fetched_at <= $2
     ORDER BY fetched_at DESC LIMIT 1`,
    [fundCode, cutoff.toISOString()],
  )
  return rows[0]?.nav ?? null
}

export async function saveWeeklyReview(
  row: Omit<WeeklyReviewRow, 'id' | 'created_at'>,
): Promise<number> {
  const { rows } = await q(
    `INSERT INTO weekly_reviews (week_start, week_end, report_md, handover_md, stats, model, emailed)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [row.week_start, row.week_end, row.report_md, row.handover_md,
     row.stats ? JSON.stringify(row.stats) : null, row.model ?? null, row.emailed ?? false],
  )
  return rows[0].id
}

export async function markWeeklyReviewEmailed(id: number): Promise<void> {
  await q(`UPDATE weekly_reviews SET emailed = true WHERE id = $1`, [id])
}

export async function getWeeklyReviews(limit = 20): Promise<WeeklyReviewRow[]> {
  const { rows } = await q(
    `SELECT * FROM weekly_reviews ORDER BY week_end DESC LIMIT $1`,
    [limit],
  )
  return rows
}

// ── SYSTEM ──

export async function claimPendingRefresh(kind: 'stock' | 'gold' | 'fund' = 'stock'): Promise<boolean> {
  const { rows } = await q(
    `SELECT id FROM price_refresh_requests WHERE kind = $1 AND processed_at IS NULL LIMIT 10`,
    [kind],
  )
  if (rows.length === 0) return false
  const ids = rows.map((r: { id: number }) => r.id)
  await q(
    `UPDATE price_refresh_requests SET processed_at = now() WHERE id = ANY($1)`,
    [ids],
  )
  return true
}

// ── ANALYSIS JOBS ──

export async function enqueueAnalysisJobs(jobRows: AnalysisJobRow[]): Promise<boolean> {
  try {
    for (const r of jobRows) {
      await q(
        `INSERT INTO analysis_jobs (ticker, kind, persona, run_id, status, priority, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [r.ticker, r.kind, r.persona ?? null, r.run_id,
         r.status ?? 'pending', r.priority ?? 0,
         r.payload ? JSON.stringify(r.payload) : null],
      )
    }
    return true
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return false
    throw err
  }
}

export async function claimAnalysisJob(maxAttempts = 3): Promise<AnalysisJobRow | null> {
  const { rows } = await q(
    `SELECT * FROM claim_analysis_job($1)`,
    [maxAttempts],
  )
  return rows[0] ?? null
}

export async function completeJob(id: number, result: Record<string, unknown> | null): Promise<void> {
  await q(
    `UPDATE analysis_jobs SET status = 'done', result = $2, finished_at = now() WHERE id = $1`,
    [id, result ? JSON.stringify(result) : null],
  )
}

export async function failJob(id: number, message: string, attempts: number, maxAttempts = 3): Promise<void> {
  const status = attempts < maxAttempts ? 'pending' : 'error'
  await q(
    `UPDATE analysis_jobs SET status = $2, error = $3, finished_at = $4 WHERE id = $1`,
    [id, status, message, status === 'error' ? new Date().toISOString() : null],
  )
}

export async function requeueStaleJobs(staleMinutes: number, maxAttempts = 3): Promise<void> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString()
  // A job killed mid-run on its last attempt must NOT go back to 'pending':
  // claim_analysis_job only takes attempts < max, so it would sit unclaimable
  // forever while hasActiveRun still counts it — blocking that ticker for good.
  await q(
    `UPDATE analysis_jobs
        SET status      = CASE WHEN attempts >= $2 THEN 'error' ELSE 'pending' END,
            error       = CASE WHEN attempts >= $2
                               THEN 'stale: worker died mid-run, attempts exhausted'
                               ELSE error END,
            finished_at = CASE WHEN attempts >= $2 THEN now() ELSE finished_at END
      WHERE status = 'running' AND started_at < $1`,
    [cutoff, maxAttempts],
  )
}

export async function hasActiveRun(ticker: string): Promise<boolean> {
  const { rows } = await q(
    `SELECT id FROM analysis_jobs WHERE ticker = $1 AND status = ANY($2) LIMIT 1`,
    [ticker, ['pending', 'running']],
  )
  return rows.length > 0
}

export async function savePersonaAnalysis(row: PersonaAnalysisRow): Promise<void> {
  await q(
    `INSERT INTO persona_analyses (run_id, snapshot_id, ticker, persona, signal, confidence, reasoning, model, analysed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [row.run_id, row.snapshot_id ?? null, row.ticker, row.persona, row.signal,
     row.confidence, row.reasoning ?? null, row.model ?? null, row.analysed_at ?? new Date().toISOString()],
  )
}

export async function upsertForexRate(
  baseCurrency: string, quoteCurrency: string, rate: number, rateAt: string,
): Promise<void> {
  await q(
    `INSERT INTO forex_rates (base_currency, quote_currency, rate, rate_at, fetched_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (base_currency, quote_currency, rate_at) DO UPDATE SET
       rate = $3, fetched_at = now()`,
    [baseCurrency, quoteCurrency, rate, rateAt],
  )
}

export async function getRunPersonaResults(runId: string): Promise<PersonaAnalysisRow[]> {
  const { rows } = await q(
    `SELECT * FROM persona_analyses WHERE run_id = $1`,
    [runId],
  )
  return rows
}
