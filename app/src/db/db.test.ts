import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 42 }], rowCount: 1 })
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: vi.fn(),
})

vi.mock('pg', () => {
  function Pool() {
    return { query: mockQuery, connect: mockConnect }
  }
  return { default: { Pool, types: { setTypeParser: () => {} } } }
})

vi.mock('@marvello/common-tech/client', () => ({
  createPool: () => ({ query: mockQuery, connect: mockConnect }),
}))

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

describe('db', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upsertPosition calls pg query', async () => {
    const { upsertPosition } = await import('./db.js')
    await upsertPosition('BBCA', 9500, 10, null)
    expect(mockQuery).toHaveBeenCalled()
    expect(mockQuery.mock.calls[0][0]).toContain('portfolio_positions')
  })

  it('saveSnapshot returns id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] })
    const { saveSnapshot } = await import('./db.js')
    const id = await saveSnapshot({
      ticker: 'BBCA', current_price: 9500, day_change: 50, day_change_pct: 0.53,
      high_52w: 10200, low_52w: 8500,
      market_cap_raw: 1.1e14, pe: 15.2, pb: 2.1, div_yield_pct: 3.0,
      volume: 1e7, lots: 10, avg_price: 9000,
      unrealized_pnl: 500, unrealized_pnl_pct: 5.56, total_pnl: 500_000,
    })
    expect(id).toBe(42)
  })

  it('saveSnapshot drops server-owned columns from a full row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 43 }] })
    const { saveSnapshot } = await import('./db.js')
    await saveSnapshot({
      id: 7, fetched_at: '2026-08-21T07:00:00Z',
      ticker: 'BBCA', current_price: 9500,
    } as never)
    const sql = mockQuery.mock.calls[0][0] as string
    const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim())
    expect(cols.filter(c => c === 'fetched_at')).toHaveLength(1)
    expect(cols).not.toContain('id')
  })

  it('requeueStaleJobs errors out attempt-exhausted running jobs', async () => {
    const { requeueStaleJobs } = await import('./db.js')
    await requeueStaleJobs(120, 3)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("attempts >= $2 THEN 'error'")
    expect(params[1]).toBe(3)
  })

  it('claimPendingRefresh returns false when no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { claimPendingRefresh } = await import('./db.js')
    const result = await claimPendingRefresh()
    expect(result).toBe(false)
  })

  it('deactivatePosition calls update', async () => {
    const { deactivatePosition } = await import('./db.js')
    await expect(deactivatePosition('BBCA')).resolves.toBeUndefined()
  })

  it('getAllPositions returns rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ticker: 'BBCA' }] })
    const { getAllPositions } = await import('./db.js')
    const result = await getAllPositions()
    expect(Array.isArray(result)).toBe(true)
  })

  it('loadPortfolio returns record', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ticker: 'BBCA', avg_price: 9000, lots: 10, notes: null }] })
    const { loadPortfolio } = await import('./db.js')
    const result = await loadPortfolio()
    expect(typeof result).toBe('object')
  })

  it('getLatestSnapshot returns null for no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { getLatestSnapshot } = await import('./db.js')
    const result = await getLatestSnapshot('UNKNOWN')
    expect(result).toBeNull()
  })

  it('getSnapshotBefore returns null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { getSnapshotBefore } = await import('./db.js')
    const result = await getSnapshotBefore('BBCA', new Date())
    expect(result).toBeNull()
  })

  it('saveAnalysis returns id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] })
    const { saveAnalysis } = await import('./db.js')
    const id = await saveAnalysis(1, 'BBCA', 'llama3', 'raw', '<p>html</p>', 'BUY', true, false)
    expect(id).toBe(42)
  })

  it('getLatestAnalysis returns null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { getLatestAnalysis } = await import('./db.js')
    const result = await getLatestAnalysis('BBCA')
    expect(result).toBeNull()
  })

  it('saveGoldSnapshot resolves', async () => {
    const { saveGoldSnapshot } = await import('./db.js')
    await expect(saveGoldSnapshot('cermati', { buy: 1_100_000, sell: 1_050_000 })).resolves.toBeUndefined()
  })

  it('getGoldPurchases returns array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { getGoldPurchases } = await import('./db.js')
    const result = await getGoldPurchases()
    expect(Array.isArray(result)).toBe(true)
  })

  it('addGoldPurchase returns id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] })
    const { addGoldPurchase } = await import('./db.js')
    const id = await addGoldPurchase('cermati', 5, 1_000_000, null)
    expect(id).toBe(42)
  })

  it('deactivateGoldPurchase resolves', async () => {
    const { deactivateGoldPurchase } = await import('./db.js')
    await expect(deactivateGoldPurchase(1)).resolves.toBeUndefined()
  })

  it('upsertFundCatalog with empty array is noop', async () => {
    const { upsertFundCatalog } = await import('./db.js')
    await expect(upsertFundCatalog([])).resolves.toBeUndefined()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('saveFundSnapshot resolves', async () => {
    const { saveFundSnapshot } = await import('./db.js')
    await expect(saveFundSnapshot('FUND001', 1500.5, '2026-06-29')).resolves.toBeUndefined()
  })

  it('getFundPurchases returns array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { getFundPurchases } = await import('./db.js')
    const result = await getFundPurchases()
    expect(Array.isArray(result)).toBe(true)
  })

  it('getBondHoldings returns array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const { getBondHoldings } = await import('./db.js')
    const result = await getBondHoldings()
    expect(Array.isArray(result)).toBe(true)
  })

  it('upsertBondCouponSchedule with empty array is noop', async () => {
    const { upsertBondCouponSchedule } = await import('./db.js')
    await expect(upsertBondCouponSchedule(1, 'SR020', [])).resolves.toBeUndefined()
  })

  it('upsertBondCouponSchedule dedupes rows sharing a distribution date', async () => {
    const { upsertBondCouponSchedule } = await import('./db.js')
    mockQuery.mockClear()
    await upsertBondCouponSchedule(7, 'ORI027T3', [
      { payment_date: '2026-08-15' },
      { payment_date: '2026-08-15' },
      { payment_date: '2026-09-15' },
    ])
    // Should have 2 INSERT calls (deduped from 3 to 2 unique dates)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  // ── FUNDAMENTALS ──

  // Same 28 names, same order, as db.ts's private KEY_STAT_COLS. Kept separate
  // (not imported, it isn't exported) so this test independently proves the
  // generated SQL/values alignment rather than trusting the source constant.
  const KEY_STAT_COLS = [
    'forward_pe', 'peg_ratio', 'price_to_book', 'enterprise_value', 'book_value',
    'trailing_eps', 'forward_eps', 'profit_margins', 'ebitda_margins',
    'return_on_equity', 'revenue_growth', 'earnings_growth', 'current_ratio',
    'quick_ratio', 'total_cash', 'total_debt', 'free_cashflow',
    'operating_cashflow', 'target_mean', 'target_high', 'target_low',
    'recommendation_key', 'analyst_count', 'shares_outstanding', 'float_shares',
    'held_pct_insiders', 'held_pct_institutions', 'change_52w',
  ] as const

  it('saveKeyStats builds INSERT/UPDATE placeholders that line up with the values array', async () => {
    const { saveKeyStats } = await import('./db.js')

    // Distinct sentinel value per field so a misplaced index is provably visible.
    const stats = Object.fromEntries(
      KEY_STAT_COLS.map((c, i) => [c, c === 'recommendation_key' ? 'STRONG_BUY' : i]),
    ) as never

    await saveKeyStats('BBCA', stats)
    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]]

    // ticker + 28 metrics = 29 positional values; fetched_at is `now()`, not a param.
    expect(values).toHaveLength(1 + KEY_STAT_COLS.length)
    expect(values[0]).toBe('BBCA')

    const insertCols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')'))
      .split(',').map((c) => c.trim())
    expect(insertCols).toEqual(['ticker', ...KEY_STAT_COLS, 'fetched_at'])

    const valuesClause = sql.slice(sql.indexOf('VALUES (') + 'VALUES ('.length, sql.indexOf(', now())'))
    const placeholders = valuesClause.split(',').map((p) => p.trim())
    const updateClause = sql.slice(sql.indexOf('DO UPDATE SET') + 'DO UPDATE SET'.length, sql.lastIndexOf(', fetched_at = now()'))
    const updates = updateClause.split(',').map((u) => u.trim())

    // For every column: its INSERT placeholder and its UPDATE assignment must
    // point at the same $N, and that $N's slot in `values` must hold that
    // column's own value (not a neighbour's).
    KEY_STAT_COLS.forEach((col, i) => {
      const paramIndex = i + 2 // 1 = ticker
      expect(placeholders[i + 1]).toBe(`$${paramIndex}`)
      expect(updates[i]).toBe(`${col} = $${paramIndex}`)
      expect(values[paramIndex - 1]).toBe(stats[col])
    })

    // Spot-check a named column end to end.
    const recIdx = KEY_STAT_COLS.indexOf('recommendation_key')
    expect(values[recIdx + 1]).toBe('STRONG_BUY')
    expect(updates[recIdx]).toBe(`recommendation_key = $${recIdx + 2}`)
  })

  it('saveFinancials inserts one row per period', async () => {
    const { saveFinancials } = await import('./db.js')
    await saveFinancials('BBCA', [
      { period_end: '2026-06-30', period_type: 'QUARTERLY', revenue: 100, cost_of_revenue: 40,
        gross_profit: 60, operating_income: 30, net_income: 20, eps: 12.5,
        gross_margin_pct: 60, operating_margin_pct: 30, net_margin_pct: 20, currency: 'IDR' },
      { period_end: '2026-03-31', period_type: 'QUARTERLY', revenue: 90, cost_of_revenue: 36,
        gross_profit: 54, operating_income: 27, net_income: 18, eps: 11.2,
        gross_margin_pct: 60, operating_margin_pct: 30, net_margin_pct: 20, currency: 'IDR' },
    ])
    expect(mockQuery).toHaveBeenCalledTimes(2)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('stock_financials')
    expect(params).toEqual(['BBCA', '2026-06-30', 'QUARTERLY', 100, 40, 60, 30, 20, 12.5, 60, 30, 20, 'IDR'])
  })

  it('saveCorporateActions upserts each event with JSON details and the given source', async () => {
    const { saveCorporateActions } = await import('./db.js')
    await saveCorporateActions('BBCA', 'DIVIDEND', [
      { event_date: '2026-05-01', amount: 150, details: { note: 'final' } },
    ], 'ksei')
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('corporate_actions')
    expect(params).toEqual(['BBCA', 'DIVIDEND', '2026-05-01', null, 150, JSON.stringify({ note: 'final' }), 'ksei'])
  })

  it('saveCorporateActions defaults missing ratio/amount/details', async () => {
    const { saveCorporateActions } = await import('./db.js')
    await saveCorporateActions('BBCA', 'SPLIT', [{ event_date: '2026-05-01' }], 'yahoo')
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual(['BBCA', 'SPLIT', '2026-05-01', null, null, '{}', 'yahoo'])
  })

})
