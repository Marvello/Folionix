import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('refreshFundamentals', () => {
  beforeEach(() => { vi.resetModules() })

  it('records one result per ticker and keeps going after a failure', async () => {
    vi.doMock('../db/db.js', () => ({
      loadPortfolio: async () => ({ 'BBCA.JK': { avg_price: 6240, lots: 12, notes: null } }),
      getWatchlist: async () => [{ ticker: 'BSSR.JK' }],
      saveKeyStats: vi.fn(async () => {}),
      saveFinancials: vi.fn(async () => {}),
      saveCorporateActions: vi.fn(async () => {}),
    }))
    vi.doMock('../providers/market.js', () => ({
      fetchKeyStats: async (t: string) => {
        if (t === 'BSSR.JK') throw new Error('yahoo 404')
        return { price_to_book: 4.1 }
      },
      fetchFinancials: async () => [{ period_end: '2026-06-30' }],
      fetchSplits: async () => [],
    }))

    const { refreshFundamentals } = await import('./fundamentals.js')
    const results = await refreshFundamentals()

    expect(results).toHaveLength(2)
    const bbca = results.find((r) => r.ticker === 'BBCA.JK')!
    expect(bbca.keyStats).toBe(true)
    expect(bbca.periods).toBe(1)
    const bssr = results.find((r) => r.ticker === 'BSSR.JK')!
    expect(bssr.error).toContain('yahoo 404')
    expect(bssr.keyStats).toBe(false)
  })

  it('honours an explicit ticker list', async () => {
    vi.doMock('../db/db.js', () => ({
      loadPortfolio: async () => ({ 'BBCA.JK': {}, 'TLKM.JK': {} }),
      getWatchlist: async () => [],
      saveKeyStats: vi.fn(async () => {}),
      saveFinancials: vi.fn(async () => {}),
      saveCorporateActions: vi.fn(async () => {}),
    }))
    vi.doMock('../providers/market.js', () => ({
      fetchKeyStats: async () => ({ price_to_book: 1 }),
      fetchFinancials: async () => [],
      fetchSplits: async () => [],
    }))
    const { refreshFundamentals } = await import('./fundamentals.js')
    const results = await refreshFundamentals(['TLKM'])
    expect(results.map((r) => r.ticker)).toEqual(['TLKM.JK'])
  })
})
