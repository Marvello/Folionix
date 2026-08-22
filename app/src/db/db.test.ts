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
})
