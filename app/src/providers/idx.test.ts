import { describe, it, expect, vi } from 'vitest'

const sample = {
  Dividen: [{
    TanggalCum: '2026-07-01T00:00:00',
    TanggalExRegulerDanNegosiasi: '2026-07-02T00:00:00',
    TanggalDPS: '2026-07-03T16:15:00',
    TanggalPembayaran: '2026-07-24T00:00:00',
    CashDividenPerSaham: 12.0,
    CashDividenPerSahamMU: 'IDR',
  }],
}

vi.mock('got-scraping', () => ({
  gotScraping: vi.fn().mockResolvedValue({ statusCode: 200, body: JSON.stringify(sample) }),
}))

describe('fetchDividendSchedule', () => {
  it('maps IDX Dividen[] to events with sliced dates + amount', async () => {
    const { fetchDividendSchedule } = await import('./idx.js')
    const ev = await fetchDividendSchedule('MDKA')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toEqual({
      cum_date: '2026-07-01', ex_date: '2026-07-02', recording_date: '2026-07-03',
      pay_date: '2026-07-24', amount_per_share: 12.0, currency: 'IDR',
    })
  })

  it('returns [] when Dividen is absent/empty', async () => {
    const { gotScraping } = await import('got-scraping')
    vi.mocked(gotScraping).mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Dividen: [] }) } as any)
    const { fetchDividendSchedule } = await import('./idx.js')
    expect(await fetchDividendSchedule('GOTO')).toEqual([])
  })

  it('reuses one cookie jar + session token across requests', async () => {
    const { gotScraping } = await import('got-scraping')
    const { fetchDividendSchedule } = await import('./idx.js')
    await fetchDividendSchedule('BBCA')
    await fetchDividendSchedule('TLKM')
    const calls = vi.mocked(gotScraping).mock.calls
    const [a, b] = calls.slice(-2).map(c => c[0] as any)
    expect(a.cookieJar).toBeDefined()
    expect(a.sessionToken).toBeDefined()
    expect(a.cookieJar).toBe(b.cookieJar)
    expect(a.sessionToken).toBe(b.sessionToken)
  })
})

describe('IDX-IC classification', () => {
  const row = { KodeEmiten: 'BBCA', NamaEmiten: 'PT Bank Central Asia Tbk.', Sektor: 'Keuangan', SubSektor: 'Bank',
    Industri: 'Bank', SubIndustri: 'Bank', PapanPencatatan: 'Utama', TanggalPencatatan: '2000-05-31T00:00:00' }

  it('maps a profile row to a yahoo-keyed classification', async () => {
    const { mapClassification } = await import('./idx.js')
    expect(mapClassification(row)).toEqual({ ticker: 'BBCA.JK', name: 'PT Bank Central Asia Tbk.', sector: 'Keuangan',
      sub_sector: 'Bank', industry: 'Bank', sub_industry: 'Bank', board: 'Utama', listed_at: '2000-05-31' })
    expect(mapClassification({ NamaEmiten: 'no code' })).toBeNull()
  })

  it('refuses a truncated listing rather than shrinking the table', async () => {
    const { gotScraping } = await import('got-scraping')
    vi.mocked(gotScraping).mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ data: [row] }) } as never)
    const { fetchClassifications } = await import('./idx.js')
    await expect(fetchClassifications()).rejects.toThrow('only 1 rows')
  })
})
