import 'dotenv/config'
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
import type { KeyStats, FinancialPeriod } from '../providers/market.js'

// Shared Postgres client pattern — see common-tech/tech-standard/postgres-client.md.
// Inlined instead of a shared package: nothing to version across repos.
function createPool(config: pg.PoolConfig & { max?: number }): pg.Pool {
  const pool = new pg.Pool({
    connectionTimeoutMillis: 10_000,   // an exhausted pool fails instead of waiting forever
    idleTimeoutMillis: 30_000,
    // A runaway query or a forgotten open transaction can't hold a connection forever.
    options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
    ...config,
    max: config.max ?? 10,
  })
  // Without a listener, an idle client erroring (Postgres restart) crashes Node.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message))
  return pool
}

pg.types.setTypeParser(1082, (v: string) => v)
pg.types.setTypeParser(1114, (v: string) => v)
pg.types.setTypeParser(1184, (v: string) => v)
// numeric (ledger money/quantities, migration 046) → JS number; pg returns strings by default,
// which would concatenate in `sum + amount`. Exact in the DB; doubles in JS are fine for display/math here.
pg.types.setTypeParser(1700, (v: string) => parseFloat(v))

let _pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL required')
    _pool = createPool({ connectionString: url, max: 10, application_name: `folionix-${process.env.npm_lifecycle_event ?? 'app'}` })
  }
  return _pool
}

function q(text: string, params?: unknown[]) {
  return getPool().query(text, params)
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    // A failed ROLLBACK means the connection is bad: destroy it, don't re-pool it.
    await client.query('ROLLBACK').catch((e: Error) => { broken = e })
    throw err
  } finally {
    client.release(broken)
  }
}

// ── PORTFOLIO ──

/** Hide a position. Not a ledger write: the recompute trigger re-shows it on the next transaction. */
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

/** A snapshot to store; `id` is set when fetchStock served an already-stored row from cache. */
export type SnapshotInput = Omit<StockSnapshotRow, 'id' | 'fetched_at'> & { id?: number }

export async function saveSnapshot(data: SnapshotInput): Promise<number> {
  // A cache hit is already stored. Re-inserting it would duplicate the row and,
  // worse, re-stamp stale prices with fetched_at = now so the cache never expires.
  if (data.id != null) return data.id
  const { fetched_at: _fetched, ...fields } = data as SnapshotInput & { fetched_at?: unknown }
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
    // Direct: a ticker filter is not pushed into the recursive latest_snapshots view.
    `SELECT * FROM stock_snapshots WHERE ticker = $1 ORDER BY fetched_at DESC, id DESC LIMIT 1`,
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

export async function getKeyStats(ticker: string): Promise<Record<string, number | null> | null> {
  const { rows } = await q(`SELECT * FROM stock_key_stats WHERE ticker = $1`, [ticker])
  return rows[0] ?? null
}

// ── PEER VALUATION ──

export interface ClassificationRow {
  ticker: string; name: string | null; sector: string | null; sub_sector: string | null
  industry: string | null; sub_industry: string | null; board: string | null; listed_at: string | null
}

/** Upsert the full IDX classification list in one statement. */
export async function upsertClassifications(rows: ClassificationRow[]): Promise<void> {
  if (rows.length === 0) return
  await q(
    `INSERT INTO stock_classification (ticker, name, sector, sub_sector, industry, sub_industry, board, listed_at, updated_at)
     SELECT ticker, name, sector, sub_sector, industry, sub_industry, board, listed_at, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(ticker text, name text, sector text, sub_sector text,
            industry text, sub_industry text, board text, listed_at date)
     ON CONFLICT (ticker) DO UPDATE SET
       name = excluded.name, sector = excluded.sector, sub_sector = excluded.sub_sector,
       industry = excluded.industry, sub_industry = excluded.sub_industry, board = excluded.board,
       listed_at = excluded.listed_at, updated_at = excluded.updated_at`,
    [JSON.stringify(rows)],
  )
}

export async function getClassifications(): Promise<ClassificationRow[]> {
  const { rows } = await q(`SELECT ticker, name, sector, sub_sector, industry, sub_industry, board, listed_at FROM stock_classification`)
  return rows
}

export interface PeerRow { ticker: string; peer: string; rank: number; basis: string; group_name: string }

/** Replace every holding's peer list atomically (the weekly refresh recomputes them all). */
export async function replaceAllPeers(rows: PeerRow[]): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM stock_peers`)
    if (rows.length === 0) return
    await client.query(
      `INSERT INTO stock_peers (ticker, peer, rank, basis, group_name)
       SELECT ticker, peer, rank, basis, group_name
         FROM jsonb_to_recordset($1::jsonb) AS x(ticker text, peer text, rank int, basis text, group_name text)`,
      [JSON.stringify(rows)],
    )
  })
}

export async function getAllPeers(): Promise<PeerRow[]> {
  const { rows } = await q(`SELECT ticker, peer, rank, basis, group_name FROM stock_peers ORDER BY ticker, rank`)
  return rows
}

/**
 * Make the watchlist's `peer` rows match `notes` (ticker → reason). Only touches
 * kind = 'peer': a ticker the user already watches keeps its own row and kind.
 */
export async function syncPeerWatchlist(notes: Map<string, string>): Promise<{ added: number; removed: number }> {
  return withTransaction(async (client) => {
    const rows = [...notes].map(([ticker, note]) => ({ ticker, note }))
    const { rowCount: removed } = await client.query(
      `DELETE FROM watchlist WHERE kind = 'peer' AND NOT (ticker = ANY($1::text[]))`, [rows.map((r) => r.ticker)])
    const { rowCount: added } = await client.query(
      `INSERT INTO watchlist (ticker, kind, notes, added_at)
       SELECT ticker, 'peer', note, now() FROM jsonb_to_recordset($1::jsonb) AS x(ticker text, note text)
       ON CONFLICT (ticker) DO UPDATE SET notes = excluded.notes WHERE watchlist.kind = 'peer'`,
      [JSON.stringify(rows)],
    )
    return { added: added ?? 0, removed: removed ?? 0 }
  })
}

export async function saveAnnualMultiples(ticker: string, rows: Array<{ period_end: string }>): Promise<void> {
  if (rows.length === 0) return
  await q(
    `INSERT INTO stock_annual_multiples (ticker, period_end, price, net_income, equity, revenue, ebitda, net_debt, shares, pe, pb, ps, ev_ebitda, fetched_at)
     SELECT $1, period_end, price, net_income, equity, revenue, ebitda, net_debt, shares, pe, pb, ps, ev_ebitda, now()
       FROM jsonb_to_recordset($2::jsonb) AS x(period_end date, price float8, net_income float8, equity float8, revenue float8,
            ebitda float8, net_debt float8, shares float8, pe float8, pb float8, ps float8, ev_ebitda float8)
     ON CONFLICT (ticker, period_end) DO UPDATE SET
       price = excluded.price, net_income = excluded.net_income, equity = excluded.equity, revenue = excluded.revenue,
       ebitda = excluded.ebitda, net_debt = excluded.net_debt, shares = excluded.shares, pe = excluded.pe,
       pb = excluded.pb, ps = excluded.ps, ev_ebitda = excluded.ev_ebitda, fetched_at = excluded.fetched_at`,
    [ticker, JSON.stringify(rows)],
  )
}

/** Everything the valuation needs per ticker, in one round trip. */
export async function getValuationInputs(tickers: string[]): Promise<Array<Record<string, any>>> {
  const { rows } = await q(
    `SELECT t.ticker, c.sector, c.sub_industry, k.market_cap, k.trailing_pe, k.price_to_book, k.total_revenue, k.ebitda,
            k.total_debt, k.total_cash, k.return_on_equity, k.earnings_growth, k.revenue_growth, k.ebitda_margins,
            (SELECT s.div_yield_pct FROM stock_snapshots s WHERE s.ticker = t.ticker ORDER BY s.fetched_at DESC, s.id DESC LIMIT 1) AS div_yield_pct,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('pe', a.pe, 'pb', a.pb, 'ps', a.ps, 'ev_ebitda', a.ev_ebitda,
                                                         'ebitda', a.ebitda, 'net_income', a.net_income) ORDER BY a.period_end DESC)
                        FROM stock_annual_multiples a WHERE a.ticker = t.ticker), '[]'::jsonb) AS annual
       FROM unnest($1::text[]) AS t(ticker)
       LEFT JOIN stock_classification c ON c.ticker = t.ticker
       LEFT JOIN stock_key_stats k ON k.ticker = t.ticker`,
    [tickers],
  )
  return rows
}

export async function saveValuation(ticker: string, lens: string, summary: string, result: unknown): Promise<void> {
  await q(
    `INSERT INTO stock_valuation (ticker, computed_at, lens, summary, result) VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (ticker) DO UPDATE SET computed_at = now(), lens = excluded.lens, summary = excluded.summary, result = excluded.result`,
    [ticker, lens, summary, JSON.stringify(result)],
  )
}

export async function getValuation(ticker: string): Promise<{ summary: string; lens: string; computed_at: string; result: any } | null> {
  const { rows } = await q(`SELECT summary, lens, computed_at, result FROM stock_valuation WHERE ticker = $1`, [ticker])
  return rows[0] ?? null
}

export async function getClassification(ticker: string): Promise<ClassificationRow | null> {
  const { rows } = await q(`SELECT ticker, name, sector, sub_sector, industry, sub_industry, board, listed_at FROM stock_classification WHERE ticker = $1`, [ticker])
  return rows[0] ?? null
}

// ── RETENTION ──

/**
 * Thin history older than `days` (opt-in via RETENTION_DAYS): keep the last
 * snapshot per ticker per WIB day (enough for the daily indicators and the
 * accuracy RPC) and never one an analysis references; drop old news cache and
 * finished jobs. Returns rows deleted per table.
 */
export async function pruneHistory(days: number): Promise<Record<string, number>> {
  const snaps = await q(
    `DELETE FROM stock_snapshots s USING (
       SELECT id, row_number() OVER (
                PARTITION BY ticker, (fetched_at AT TIME ZONE 'Asia/Jakarta')::date
                ORDER BY fetched_at DESC, id DESC) AS rn
         FROM stock_snapshots
        WHERE fetched_at < now() - make_interval(days => $1)) d
      WHERE s.id = d.id AND d.rn > 1
        AND NOT EXISTS (SELECT 1 FROM llm_analyses a WHERE a.snapshot_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM persona_analyses p WHERE p.snapshot_id = s.id)`,
    [days],
  )
  const news = await q(`DELETE FROM news_cache WHERE fetched_at < now() - make_interval(days => $1)`, [days])
  const jobs = await q(
    `DELETE FROM analysis_jobs WHERE status IN ('done', 'error') AND finished_at < now() - make_interval(days => $1)`,
    [days],
  )
  return { stock_snapshots: snaps.rowCount ?? 0, news_cache: news.rowCount ?? 0, analysis_jobs: jobs.rowCount ?? 0 }
}

// ── SCHEDULED RUNS ──

/**
 * Claim a scheduled job's slot. True exactly once per (job, runKey) across restarts
 * and replicas. Claimed before running, so a crash mid-job skips that slot rather
 * than repeating user-visible side effects (reminders, emails).
 */
export async function claimScheduledRun(job: string, runKey: string): Promise<boolean> {
  const { rowCount } = await q(
    `INSERT INTO scheduled_runs (job, run_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [job, runKey],
  )
  return rowCount === 1
}

export async function markAnalysisSent(id: number): Promise<void> {
  await q(`UPDATE llm_analyses SET sent_telegram = true WHERE id = $1`, [id])
}

/** Latest analysis actually delivered to Telegram — the baseline for alert dedup. */
export async function getLastAlertedAnalysis(ticker: string): Promise<LlmAnalysisRow | null> {
  const { rows } = await q(
    `SELECT * FROM llm_analyses WHERE ticker = $1 AND sent_telegram ORDER BY analysed_at DESC LIMIT 1`,
    [ticker],
  )
  return rows[0] ?? null
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
  // One round trip for the whole daily sweep (hundreds of funds), not one per row.
  // Last row wins if the source repeats a code (ON CONFLICT can't touch a row twice).
  const byCode = new Map(records.map(r => [r.code, {
    code: r.code, name: r.name, slug: r.slug ?? null, fund_type: r.fund_type ?? null,
    category: r.category ?? null, investment_manager: r.investment_manager ?? null,
    currency: r.currency ?? 'IDR', active: r.active ?? true,
  }]))
  await q(
    `INSERT INTO fund_catalog (code, name, slug, fund_type, category, investment_manager, currency, active, updated_at)
     SELECT code, name, slug, fund_type, category, investment_manager, currency, active, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(code text, name text, slug text, fund_type text,
            category text, investment_manager text, currency text, active boolean)
     ON CONFLICT (code) DO UPDATE SET
       name = excluded.name, slug = excluded.slug, fund_type = excluded.fund_type,
       category = excluded.category, investment_manager = excluded.investment_manager,
       currency = excluded.currency, active = excluded.active, updated_at = excluded.updated_at`,
    [JSON.stringify([...byCode.values()])],
  )
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
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM fund_holdings WHERE fund_code = $1`, [fundCode])
    if (holdings.length === 0) return
    await client.query(
      `INSERT INTO fund_holdings (fund_code, label, ticker, percentage, as_of)
       SELECT fund_code, label, ticker, percentage, as_of
         FROM jsonb_to_recordset($1::jsonb) AS x(fund_code text, label text, ticker text, percentage double precision, as_of date)`,
      [JSON.stringify(holdings.map(r => ({
        fund_code: r.fund_code, label: r.label, ticker: r.ticker ?? null, percentage: r.percentage ?? null, as_of: r.as_of,
      })))],
    )
  })
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
  // A manual row always wins; the WHERE makes that check atomic with the write.
  await q(
    `INSERT INTO dividend_schedule (ticker, cum_date, ex_date, recording_date, pay_date, amount_per_share, amount_estimated, currency, source, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'idx', now())
     ON CONFLICT (ticker, ex_date) DO UPDATE SET
       cum_date = $2, recording_date = $4, pay_date = $5, amount_per_share = $6,
       amount_estimated = $7, currency = $8, source = 'idx', synced_at = now()
     WHERE dividend_schedule.source <> 'manual'`,
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
  // One statement per call; ON CONFLICT DO NOTHING also absorbs repeats within the batch.
  const rows = articles.map(a => ({
    headline: a.headline.slice(0, 500), url: a.url.slice(0, 500),
    summary: a.summary ?? null, published_at: a.publishedAt ?? null,
  }))
  await q(
    `INSERT INTO news_cache (ticker, source, headline, url, summary, published_at, fetched_at)
     SELECT $1, $2, headline, url, summary, published_at, now()
       FROM jsonb_to_recordset($3::jsonb) AS x(headline text, url text, summary text, published_at timestamptz)
     ON CONFLICT (url) DO NOTHING`,
    [ticker, source, JSON.stringify(rows)],
  )
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

/** Any unprocessed web refresh request? Served by the partial index on pending requests. */
export async function hasPendingRefresh(): Promise<boolean> {
  const { rows } = await q(`SELECT 1 FROM price_refresh_requests WHERE processed_at IS NULL LIMIT 1`)
  return rows.length > 0
}

export async function claimPendingRefresh(kind: 'stock' | 'gold' | 'fund' = 'stock'): Promise<boolean> {
  // One atomic statement: marks every pending request of this kind, so leftovers
  // beyond a batch can't re-trigger another refresh on the next cycle.
  const { rowCount } = await q(
    `UPDATE price_refresh_requests SET processed_at = now() WHERE kind = $1 AND processed_at IS NULL`,
    [kind],
  )
  return (rowCount ?? 0) > 0
}

// ── ANALYSIS JOBS ──

export async function enqueueAnalysisJobs(jobRows: AnalysisJobRow[]): Promise<boolean> {
  // One statement = one transaction: if the per-ticker unique index rejects the
  // consensus row, no persona jobs are left behind orphaned.
  const rows = jobRows.map(r => ({
    ticker: r.ticker, kind: r.kind, persona: r.persona ?? null, run_id: r.run_id,
    status: r.status ?? 'pending', priority: r.priority ?? 0, payload: r.payload ?? null,
  }))
  try {
    await q(
      `INSERT INTO analysis_jobs (ticker, kind, persona, run_id, status, priority, payload, created_at)
       SELECT ticker, kind, persona, run_id, status, priority, payload, now()
         FROM jsonb_to_recordset($1::jsonb)
           AS x(ticker text, kind text, persona text, run_id uuid, status text, priority int, payload jsonb)`,
      [JSON.stringify(rows)],
    )
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

/** Back off before a retry: 30s, 60s, 120s, … capped at 10 min. */
export function jobRetryDelaySec(attempts: number): number {
  return Math.min(600, 30 * 2 ** Math.max(0, attempts - 1))
}

export async function failJob(id: number, message: string, attempts: number, maxAttempts = 3): Promise<void> {
  const status = attempts < maxAttempts ? 'pending' : 'error'
  await q(
    `UPDATE analysis_jobs
        SET status = $2::text, error = $3,
            finished_at = CASE WHEN $2::text = 'error' THEN now() END,
            retry_at    = CASE WHEN $2::text = 'pending' THEN now() + make_interval(secs => $4::float8) END
      WHERE id = $1`,
    [id, status, message, jobRetryDelaySec(attempts)],
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (run_id, persona) DO NOTHING`,
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

// ── FUNDAMENTALS ──

const KEY_STAT_COLS = [
  'forward_pe', 'peg_ratio', 'price_to_book', 'enterprise_value', 'book_value',
  'trailing_eps', 'forward_eps', 'profit_margins', 'ebitda_margins',
  'return_on_equity', 'revenue_growth', 'earnings_growth', 'current_ratio',
  'quick_ratio', 'total_cash', 'total_debt', 'free_cashflow',
  'operating_cashflow', 'target_mean', 'target_high', 'target_low',
  'recommendation_key', 'analyst_count', 'shares_outstanding', 'float_shares',
  'held_pct_insiders', 'held_pct_institutions', 'change_52w',
  'market_cap', 'total_revenue', 'ebitda', 'trailing_pe',
] as const

export async function saveKeyStats(ticker: string, stats: KeyStats): Promise<void> {
  const cols = ['ticker', ...KEY_STAT_COLS, 'fetched_at']
  const values = [ticker, ...KEY_STAT_COLS.map((c) => stats[c as keyof KeyStats])]
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
  const updates = KEY_STAT_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')
  await q(
    `INSERT INTO stock_key_stats (${cols.join(', ')})
     VALUES (${placeholders}, now())
     ON CONFLICT (ticker) DO UPDATE SET ${updates}, fetched_at = now()`,
    values,
  )
}

export async function saveFinancials(ticker: string, periods: FinancialPeriod[]): Promise<void> {
  for (const p of periods) {
    await q(
      `INSERT INTO stock_financials
         (ticker, period_end, period_type, revenue, cost_of_revenue, gross_profit,
          operating_income, net_income, eps, gross_margin_pct, operating_margin_pct,
          net_margin_pct, currency, source, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'yahoo',now())
       ON CONFLICT (ticker, period_end, period_type) DO UPDATE SET
         revenue = $4, cost_of_revenue = $5, gross_profit = $6,
         operating_income = $7, net_income = $8, eps = $9,
         gross_margin_pct = $10, operating_margin_pct = $11,
         net_margin_pct = $12, currency = $13, fetched_at = now()`,
      [ticker, p.period_end, p.period_type, p.revenue, p.cost_of_revenue,
       p.gross_profit, p.operating_income, p.net_income, p.eps,
       p.gross_margin_pct, p.operating_margin_pct, p.net_margin_pct, p.currency],
    )
  }
}

export async function saveCorporateActions(
  ticker: string,
  type: string,
  events: Array<{ event_date: string; ratio?: number | null; amount?: number | null; details?: Record<string, unknown> }>,
  source: string,
): Promise<void> {
  for (const e of events) {
    await q(
      `INSERT INTO corporate_actions (ticker, type, event_date, ex_date, ratio, amount, details, source, synced_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,now())
       ON CONFLICT (ticker, type, event_date) DO UPDATE SET
         ratio = $4, amount = $5, details = $6, synced_at = now()`,
      [ticker, type, e.event_date, e.ratio ?? null, e.amount ?? null,
       JSON.stringify(e.details ?? {}), source],
    )
  }
}

