// Runs against a real Postgres (schema.sql + migrations applied); skipped otherwise.
//   TEST_DATABASE_URL=postgresql://… npx vitest run src/db/queue.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('job queue + scheduler (live Postgres)', () => {
  let db: typeof import('./db')
  const c = new pg.Client({ connectionString: url })

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    db = await import('./db')
    await c.connect()
    await c.query(`truncate analysis_jobs, persona_analyses, scheduled_runs, price_refresh_requests, dividend_schedule`)
  })
  afterAll(() => c.end())

  const jobs = (run: string) => [
    { ticker: 'BBCA.JK', kind: 'persona' as const, persona: 'buffett', run_id: run },
    { ticker: 'BBCA.JK', kind: 'persona' as const, persona: 'graham', run_id: run },
    { ticker: 'BBCA.JK', kind: 'consensus' as const, run_id: run },
  ]

  it('rejects a second active run for a ticker without orphaning its persona jobs', async () => {
    const [run1, run2] = [randomUUID(), randomUUID()]
    expect(await db.enqueueAnalysisJobs(jobs(run1))).toBe(true)
    expect(await db.enqueueAnalysisJobs(jobs(run2))).toBe(false)
    const { rows } = await c.query('select count(*)::int n from analysis_jobs where run_id = $1', [run2])
    expect(rows[0].n).toBe(0)
  })

  it('does not reclaim a failed job until its backoff expires', async () => {
    const job = await db.claimAnalysisJob(3)
    await db.failJob(job!.id!, 'boom', 1, 3)
    const { rows } = await c.query('select status, retry_at > now() as later from analysis_jobs where id = $1', [job!.id])
    expect(rows[0]).toEqual({ status: 'pending', later: true })
    expect((await db.claimAnalysisJob(3))?.id).not.toBe(job!.id)
  })

  it('counts one vote per persona per run', async () => {
    const run = randomUUID()
    const vote = { run_id: run, ticker: 'BBCA.JK', persona: 'buffett', signal: 'bullish' as const, confidence: 70 }
    await db.savePersonaAnalysis(vote)
    await db.savePersonaAnalysis(vote)
    expect(await db.getRunPersonaResults(run)).toHaveLength(1)
  })

  it('claims a scheduled slot exactly once', async () => {
    expect(await db.claimScheduledRun('bonds', '2026-10-06')).toBe(true)
    expect(await db.claimScheduledRun('bonds', '2026-10-06')).toBe(false)
  })

  it('claims every pending refresh of a kind in one go', async () => {
    await c.query(`insert into price_refresh_requests (kind) values ('stock'), ('stock'), ('gold')`)
    expect(await db.claimPendingRefresh('stock')).toBe(true)
    expect(await db.claimPendingRefresh('stock')).toBe(false)
    expect(await db.claimPendingRefresh('gold')).toBe(true)
  })

  it('batch-upserts the fund catalog, tolerating a repeated code', async () => {
    const f = (name: string) => ({ code: 'IT-FUND', name, currency: 'IDR', active: true })
    await db.upsertFundCatalog([f('first'), f('second')])
    const { rows } = await c.query(`select name from fund_catalog where code = 'IT-FUND'`)
    expect(rows).toEqual([{ name: 'second' }])
  })

  it('never overwrites a manual dividend row', async () => {
    await c.query(`insert into dividend_schedule (ticker, ex_date, amount_per_share, source) values ('X.JK', '2026-11-01', 10, 'manual')`)
    await db.upsertDividendSchedule({ ticker: 'X.JK', ex_date: '2026-11-01', cum_date: null, recording_date: null,
      pay_date: null, amount_per_share: 99, amount_estimated: false, currency: 'IDR' })
    const { rows } = await c.query(`select amount_per_share, source from dividend_schedule where ticker = 'X.JK'`)
    expect(rows).toEqual([{ amount_per_share: 10, source: 'manual' }])
  })

  it('retention keeps the last snapshot per ticker per day and referenced ones', async () => {
    await c.query(`delete from llm_analyses where ticker = 'RET.JK'`)
    await c.query(`delete from stock_snapshots where ticker = 'RET.JK'`)
    const { rows } = await c.query(
      `insert into stock_snapshots (ticker, current_price, fetched_at) values
         ('RET.JK', 1, '2025-01-10 01:00+07'), ('RET.JK', 2, '2025-01-10 09:00+07'),
         ('RET.JK', 3, '2025-01-10 15:00+07'), ('RET.JK', 4, now())
       returning id`)
    await c.query(`insert into llm_analyses (snapshot_id, ticker, model, raw_output, clean_html, recommendation, analysed_at)
                   values ($1, 'RET.JK', 'm', '', '', 'HOLD', now())`, [rows[0].id])
    const res = await db.pruneHistory(180)
    expect(res.stock_snapshots).toBe(1)   // only the 09:00 row: 15:00 is the day's last, 01:00 is referenced
    const left = await c.query(`select current_price from stock_snapshots where ticker = 'RET.JK' order by current_price`)
    expect(left.rows.map(r => r.current_price)).toEqual([1, 3, 4])
  })
})
