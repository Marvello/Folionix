import { describe, it, expect, vi, beforeEach } from 'vitest'

const { quoteMock, chartMock, getLatestSnapshotMock, fetchFinnhubQuoteMock, getForexRatesToIdrMock } = vi.hoisted(() => ({
  quoteMock: vi.fn(),
  chartMock: vi.fn(),
  getLatestSnapshotMock: vi.fn(),
  fetchFinnhubQuoteMock: vi.fn(),
  getForexRatesToIdrMock: vi.fn(),
}))

vi.mock('yahoo-finance2', () => ({
  default: class {
    quote = quoteMock
    chart = chartMock
  },
}))

vi.mock('../db/db.js', () => ({
  getLatestSnapshot: getLatestSnapshotMock,
  getForexRatesToIdr: getForexRatesToIdrMock,
  getSnapshotBefore: vi.fn().mockResolvedValue(null),
  saveSnapshot: vi.fn().mockResolvedValue(1),
}))

vi.mock('./finnhub.js', () => ({
  fetchFinnhubQuote: fetchFinnhubQuoteMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  getLatestSnapshotMock.mockResolvedValue(null)
  fetchFinnhubQuoteMock.mockResolvedValue(null)
  getForexRatesToIdrMock.mockResolvedValue(new Map([['USD', 17_923.73]]))
  chartMock.mockRejectedValue(new Error('no chart'))
  quoteMock.mockResolvedValue({
    regularMarketPrice: 9600,
    regularMarketChange: 100,
    regularMarketChangePercent: 1.05,
    fiftyTwoWeekHigh: 10200,
    fiftyTwoWeekLow: 8400,
    regularMarketVolume: 12_000_000,
    marketCap: 1.15e14,
    exDividendDate: new Date('2026-07-02T00:00:00Z'),
    dividendDate: new Date('2026-07-24T00:00:00Z'),
    trailingAnnualDividendRate: 12.29,
  })
})

describe('fetchStock', () => {
  it('returns snapshot with P&L', async () => {
    const { fetchStock } = await import('./market.js')
    const snap = await fetchStock('BBCA', 9000, 10, null)
    // Storage is keyed by the yahoo symbol everywhere (migration 024);
    // display layers strip the suffix.
    expect(snap.ticker).toBe('BBCA.JK')
    expect(snap.current_price).toBe(9600)
    expect(snap.lots).toBe(10)
    expect(snap.avg_price).toBe(9000)
    expect(snap.unrealized_pnl).toBeCloseTo(600)
    expect(snap.unrealized_pnl_pct).toBeCloseTo(6.67, 1)
    expect(snap.total_pnl).toBe(600_000)   // 600 * 10 * 100
  })
})

describe('correctPriceToBook', () => {
  const fx = new Map([['USD', 17_923.73]])
  const base = { quoteCurrency: 'IDR', financialCurrency: 'IDR', fxToIdr: fx }

  it('passes through when the currencies agree', async () => {
    const { correctPriceToBook } = await import('./market.js')
    expect(correctPriceToBook({ ...base, reportedPb: 2.98, price: 6275, bookValue: 2108.889 })).toBe(2.98)
  })

  it('recomputes P/B for a USD reporter quoted in IDR', async () => {
    const { correctPriceToBook } = await import('./market.js')
    // AADI: yahoo reports 19,786 (IDR price ÷ USD book value); real P/B ≈ 1.1
    const pb = correctPriceToBook({
      ...base, financialCurrency: 'USD', reportedPb: 19_786.994, price: 8825, bookValue: 0.446,
    })
    expect(pb).toBeCloseTo(1.10, 2)
  })

  it('returns null rather than a junk ratio when the rate is missing', async () => {
    const { correctPriceToBook } = await import('./market.js')
    expect(correctPriceToBook({
      ...base, financialCurrency: 'USD', reportedPb: 19_786.994, price: 8825, bookValue: 0.446,
      fxToIdr: new Map(),
    })).toBeNull()
  })

  it('returns null when book value is missing or non-positive', async () => {
    const { correctPriceToBook } = await import('./market.js')
    expect(correctPriceToBook({ ...base, financialCurrency: 'USD', reportedPb: 100, price: 8825, bookValue: null })).toBeNull()
    expect(correctPriceToBook({ ...base, financialCurrency: 'USD', reportedPb: 100, price: 8825, bookValue: 0 })).toBeNull()
  })

  it('keeps null P/B null', async () => {
    const { correctPriceToBook } = await import('./market.js')
    expect(correctPriceToBook({ ...base, reportedPb: null, price: 6275, bookValue: 2108.889 })).toBeNull()
  })
})

describe('fetchStock — P/B currency mismatch', () => {
  it('stores the corrected ratio, not yahoo\'s inflated one', async () => {
    quoteMock.mockResolvedValue({
      regularMarketPrice: 8825, priceToBook: 19_786.994, bookValue: 0.446,
      currency: 'IDR', financialCurrency: 'USD', trailingPE: 5.42,
    })
    const { fetchStock } = await import('./market.js')
    const snap = await fetchStock('AADI', 8000, 1, null, true)
    expect(snap.pb).toBeCloseTo(1.10, 2)
    expect(snap.pe).toBe(5.42)   // P/E is currency-consistent already
  })

  it('leaves a same-currency ratio untouched', async () => {
    quoteMock.mockResolvedValue({
      regularMarketPrice: 6275, priceToBook: 2.98, bookValue: 2108.889,
      currency: 'IDR', financialCurrency: 'IDR',
    })
    const { fetchStock } = await import('./market.js')
    const snap = await fetchStock('BBCA', 6000, 1, null, true)
    expect(snap.pb).toBe(2.98)
  })
})

describe('fetchStock — Finnhub fallback sanity gate', () => {
  beforeEach(() => {
    quoteMock.mockRejectedValue(new Error('yahoo down'))
  })

  it('queries Finnhub with the suffixed yahoo symbol', async () => {
    const { fetchStock } = await import('./market.js')
    await fetchStock('HEAL', 800, 10, null, true)
    expect(fetchFinnhubQuoteMock).toHaveBeenCalledWith('HEAL.JK')
  })

  it('rejects a fallback price wildly off the last snapshot', async () => {
    // Real incident: bare 'HEAL' resolved to a US stock — $28.56 vs Rp 845
    getLatestSnapshotMock.mockResolvedValue({ current_price: 845 })
    fetchFinnhubQuoteMock.mockResolvedValue({ c: 28.56, d: 0.1, dp: 0.4, h: 29, l: 28 })

    const { fetchStock } = await import('./market.js')
    const snap = await fetchStock('HEAL', 800, 10, null, true)
    expect(snap.current_price).toBeNull()
  })

  it('accepts a fallback price consistent with the last snapshot', async () => {
    getLatestSnapshotMock.mockResolvedValue({ current_price: 845 })
    fetchFinnhubQuoteMock.mockResolvedValue({ c: 880, d: 35, dp: 4.1, h: 900, l: 840 })

    const { fetchStock } = await import('./market.js')
    const snap = await fetchStock('HEAL', 800, 10, null, true)
    expect(snap.current_price).toBe(880)
  })

  it('accepts a fallback price when there is no snapshot to compare', async () => {
    fetchFinnhubQuoteMock.mockResolvedValue({ c: 880, d: 35, dp: 4.1, h: 900, l: 840 })

    const { fetchStock } = await import('./market.js')
    const snap = await fetchStock('HEAL', 800, 10, null, true)
    expect(snap.current_price).toBe(880)
  })
})

describe('fetchDividendDates', () => {
  it('maps yahoo ex/pay/amount to WIB dates', async () => {
    const { fetchDividendDates } = await import('./market.js')
    const d = await fetchDividendDates('BBCA')
    expect(d).not.toBeNull()
    expect(d!.ex_date).toBe('2026-07-02')
    expect(d!.pay_date).toBe('2026-07-24')
    expect(d!.amount_per_share).toBeCloseTo(12.29)
  })
})

describe('fetchDividendAmount', () => {
  it('returns the trailing annual rate', async () => {
    const { fetchDividendAmount } = await import('./market.js')
    expect(await fetchDividendAmount('BBCA')).toBeCloseTo(12.29)
  })
})
