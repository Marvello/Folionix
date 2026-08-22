import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/db.js', () => ({
  loadPortfolio: vi.fn(),
  upsertDividendSchedule: vi.fn(),
  getDividendScheduleForExDate: vi.fn().mockResolvedValue([]),
  getDividendScheduleForPayDate: vi.fn().mockResolvedValue([]),
}))
vi.mock('../providers/idx.js', () => ({ fetchDividendSchedule: vi.fn() }))
vi.mock('../providers/market.js', () => ({ fetchDividendAmount: vi.fn() }))
vi.mock('../telegram/client.js', () => ({ sendTelegram: vi.fn() }))

// resetAllMocks clears implementations (no cross-test leakage); re-establish the
// getter [] defaults so a test that only sets one getter doesn't hit undefined.
beforeEach(async () => {
  vi.resetAllMocks()
  const db = await import('../db/db.js')
  vi.mocked(db.getDividendScheduleForExDate).mockResolvedValue([])
  vi.mocked(db.getDividendScheduleForPayDate).mockResolvedValue([])
})

const idxEvent = (over = {}) => ({
  cum_date: '2026-07-01', ex_date: '2026-07-02', recording_date: '2026-07-03',
  pay_date: '2026-07-24', amount_per_share: 12, currency: 'IDR', ...over,
})

describe('syncDividendSchedules (consolidation)', () => {
  it('IDX amount present → upsert as-is, no yahoo call, amount_estimated false', async () => {
    const { loadPortfolio, upsertDividendSchedule } = await import('../db/db.js')
    const { fetchDividendSchedule } = await import('../providers/idx.js')
    const { fetchDividendAmount } = await import('../providers/market.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ MDKA: { avg_price: 2500, lots: 10, notes: null } })
    vi.mocked(fetchDividendSchedule).mockResolvedValue([idxEvent()])
    const { syncDividendSchedules } = await import('./dividends.js')
    await syncDividendSchedules()
    expect(fetchDividendAmount).not.toHaveBeenCalled()
    expect(upsertDividendSchedule).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'MDKA', amount_per_share: 12, amount_estimated: false }))
  })

  it('IDX amount 0/null + yahoo rate → backfill, amount_estimated true', async () => {
    const { loadPortfolio, upsertDividendSchedule } = await import('../db/db.js')
    const { fetchDividendSchedule } = await import('../providers/idx.js')
    const { fetchDividendAmount } = await import('../providers/market.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ TLKM: { avg_price: 3000, lots: 5, notes: null } })
    vi.mocked(fetchDividendSchedule).mockResolvedValue([idxEvent({ amount_per_share: null })])
    vi.mocked(fetchDividendAmount).mockResolvedValue(45)
    const { syncDividendSchedules } = await import('./dividends.js')
    await syncDividendSchedules()
    expect(upsertDividendSchedule).toHaveBeenCalledWith(expect.objectContaining({ amount_per_share: 45, amount_estimated: true }))
  })

  it('IDX amount null + yahoo null → amount null, amount_estimated false', async () => {
    const { loadPortfolio, upsertDividendSchedule } = await import('../db/db.js')
    const { fetchDividendSchedule } = await import('../providers/idx.js')
    const { fetchDividendAmount } = await import('../providers/market.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ TLKM: { avg_price: 3000, lots: 5, notes: null } })
    vi.mocked(fetchDividendSchedule).mockResolvedValue([idxEvent({ amount_per_share: null })])
    vi.mocked(fetchDividendAmount).mockResolvedValue(null)
    const { syncDividendSchedules } = await import('./dividends.js')
    await syncDividendSchedules()
    expect(upsertDividendSchedule).toHaveBeenCalledWith(expect.objectContaining({ amount_per_share: null, amount_estimated: false }))
  })

  it('waits between tickers to avoid tripping IDX rate limits', async () => {
    vi.useFakeTimers()
    try {
      const { loadPortfolio } = await import('../db/db.js')
      const { fetchDividendSchedule } = await import('../providers/idx.js')
      vi.mocked(loadPortfolio).mockResolvedValue({
        BBCA: { avg_price: 9000, lots: 10, notes: null },
        TLKM: { avg_price: 3000, lots: 5, notes: null },
      })
      vi.mocked(fetchDividendSchedule).mockResolvedValue([])
      const { syncDividendSchedules } = await import('./dividends.js')
      const done = syncDividendSchedules()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchDividendSchedule).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(3000)
      expect(fetchDividendSchedule).toHaveBeenCalledTimes(2)
      await done
    } finally {
      vi.useRealTimers()
    }
  })

  it('IDX returns [] → nothing upserted, sweep continues', async () => {
    const { loadPortfolio, upsertDividendSchedule } = await import('../db/db.js')
    const { fetchDividendSchedule } = await import('../providers/idx.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ GOTO: { avg_price: 100, lots: 5, notes: null } })
    vi.mocked(fetchDividendSchedule).mockResolvedValue([])
    const { syncDividendSchedules } = await import('./dividends.js')
    await syncDividendSchedules()
    expect(upsertDividendSchedule).not.toHaveBeenCalled()
  })
})

const row = (over = {}) => ({
  id: 1, ticker: 'BBCA', cum_date: null, ex_date: '2026-07-02', recording_date: null,
  pay_date: '2026-08-01', amount_per_share: 20, amount_estimated: false, currency: 'IDR',
  source: 'idx', synced_at: '', ...over,
})

describe('sendDividendReminders (tiers)', () => {
  it('exact amount → plain total', async () => {
    const { loadPortfolio, getDividendScheduleForExDate } = await import('../db/db.js')
    const { wibDateOffset } = await import('../../../lib/format.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ BBCA: { avg_price: 9000, lots: 10, notes: null } })
    vi.mocked(getDividendScheduleForExDate).mockImplementation(async (d: string) => d === wibDateOffset(1) ? [row({ ex_date: d })] : [])
    const { sendDividendReminders } = await import('./dividends.js')
    await sendDividendReminders()
    const msg = vi.mocked(sendTelegram).mock.calls[0][0]
    expect(msg).toContain('BBCA')
    expect(msg).not.toContain('est')
    expect(msg).not.toContain('unavailable')
  })

  it('estimated amount → ~est verify tag', async () => {
    const { loadPortfolio, getDividendScheduleForExDate } = await import('../db/db.js')
    const { wibDateOffset } = await import('../../../lib/format.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ BBCA: { avg_price: 9000, lots: 10, notes: null } })
    vi.mocked(getDividendScheduleForExDate).mockImplementation(async (d: string) => d === wibDateOffset(1) ? [row({ ex_date: d, amount_estimated: true })] : [])
    const { sendDividendReminders } = await import('./dividends.js')
    await sendDividendReminders()
    expect(vi.mocked(sendTelegram).mock.calls[0][0]).toContain('est')
  })

  it('null amount → unavailable warning', async () => {
    const { loadPortfolio, getDividendScheduleForExDate } = await import('../db/db.js')
    const { wibDateOffset } = await import('../../../lib/format.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ BBCA: { avg_price: 9000, lots: 10, notes: null } })
    vi.mocked(getDividendScheduleForExDate).mockImplementation(async (d: string) => d === wibDateOffset(1) ? [row({ ex_date: d, amount_per_share: null })] : [])
    const { sendDividendReminders } = await import('./dividends.js')
    await sendDividendReminders()
    expect(vi.mocked(sendTelegram).mock.calls[0][0]).toContain('unavailable')
  })

  it('no-op when nothing due', async () => {
    const { loadPortfolio } = await import('../db/db.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(loadPortfolio).mockResolvedValue({ BBCA: { avg_price: 9000, lots: 10, notes: null } })
    const { sendDividendReminders } = await import('./dividends.js')
    await sendDividendReminders()
    expect(sendTelegram).not.toHaveBeenCalled()
  })
})
