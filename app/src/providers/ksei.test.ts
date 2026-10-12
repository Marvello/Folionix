import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal KSEI HTML fixture — government bond listing page.
// Expected structure:
//   - tbody with <tr> rows
//   - td[0] = CA type ("Interest" or "Bunga")
//   - td[4] = distribution date cell containing <span class="hidden">YYYYMMDD</span>
//   - td[5] = status text
const makeKseiHtml = (rows: string) => `
<html><body>
<table><tbody>
${rows}
</tbody></table>
</body></html>
`

const twoRowsHtml = makeKseiHtml(`
  <tr>
    <td>Interest</td>
    <td>SR020</td>
    <td>6.875%</td>
    <td>Monthly</td>
    <td><span class="hidden">20260817</span>17 Aug 2026</td>
    <td>Scheduled</td>
  </tr>
  <tr>
    <td>Interest</td>
    <td>SR020</td>
    <td>6.875%</td>
    <td>Monthly</td>
    <td><span class="hidden">20260917</span>17 Sep 2026</td>
    <td>Paid</td>
  </tr>
  <tr>
    <td>Redemption</td>
    <td>SR020</td>
    <td></td>
    <td></td>
    <td><span class="hidden">20271010</span>10 Oct 2027</td>
    <td>Scheduled</td>
  </tr>
`)

const emptyTbodyHtml = makeKseiHtml('')

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('fetchCouponSchedule', () => {
  it('returns schedule array for government bond', async () => {
    process.env.KSEI_BASE_URL = 'https://web.ksei.co.id/services/registered-securities'
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => twoRowsHtml,
    } as unknown as Response)

    const { fetchCouponSchedule } = await import('./ksei.js')
    const schedule = await fetchCouponSchedule('SR020')

    // Should have 2 interest rows (Redemption is filtered out)
    expect(schedule).toHaveLength(2)
    expect(schedule[0].payment_date).toBe('2026-08-17')
    expect(schedule[0].amount_per_unit).toBeNull()
    expect(schedule[1].payment_date).toBe('2026-09-17')
    expect(schedule[1].amount_per_unit).toBeNull()
  })

  it('uses government-bonds URL for SR series', async () => {
    process.env.KSEI_BASE_URL = 'https://web.ksei.co.id/services/registered-securities'
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => emptyTbodyHtml,
    } as unknown as Response)
    global.fetch = mockFetch

    const { fetchCouponSchedule } = await import('./ksei.js')
    await fetchCouponSchedule('SR020')

    const calledUrl = (mockFetch.mock.calls[0] as unknown[])[0] as string
    expect(calledUrl).toContain('government-bonds')
    expect(calledUrl).toContain('SR020')
  })

  it('uses corporate-bonds URL for CORP series', async () => {
    process.env.KSEI_BASE_URL = 'https://web.ksei.co.id/services/registered-securities'
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => emptyTbodyHtml,
    } as unknown as Response)
    global.fetch = mockFetch

    const { fetchCouponSchedule } = await import('./ksei.js')
    await fetchCouponSchedule('SOME_CORP_BOND')

    const calledUrl = (mockFetch.mock.calls[0] as unknown[])[0] as string
    expect(calledUrl).toContain('corporate-bonds')
  })

  it('returns empty array on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as unknown as Response)

    const { fetchCouponSchedule } = await import('./ksei.js')
    const schedule = await fetchCouponSchedule('SR999')
    expect(schedule).toEqual([])
  })

  it('returns empty array when no tbody found', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body><table></table></body></html>',
    } as unknown as Response)

    const { fetchCouponSchedule } = await import('./ksei.js')
    const schedule = await fetchCouponSchedule('SR020')
    expect(schedule).toEqual([])
  })

  it('returns empty array on network error', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const { fetchCouponSchedule } = await import('./ksei.js')
    const schedule = await fetchCouponSchedule('SR020')
    expect(schedule).toEqual([])
  })
})

// ── new-securities registration (new bond alert) ────────────────────────────

// Real markup from web.ksei.co.id/publications/new-securities-registration:
// each announcement = h2 (ref) · small>b (date) · p (title) · a[href] (pdf).
const newSecHtml = `
<div class="card">
  <h2 class="h4 no-margin">KSEI-7442/DIR/1026</h2>
  <small class="muted"><b>09 Oktober 2026</b></small>
  <p class="no-margin">Pendaftaran Obligasi Berkelanjutan V Sarana Multi Infrastruktur Tahap II Tahun 2026</p>
  <a class="btn btn--primary" href="/Announcement/Files/200437_ksei_7442_dir_1026_202610091832.pdf">unduh</a>
</div>
<div class="card">
  <h2 class="h4 no-margin">KSEI-25538/JKU/1026</h2>
  <small class="muted"><b>09 Oktober 2026</b></small>
  <p class="no-margin">Pendaftaran Sukuk Berkelanjutan 2 Yang Ditawarkan Melalui Layanan Urun Dana</p>
  <a class="btn btn--primary" href="/Announcement/Files/200436_ksei_25538_jku_1026_202610091723.pdf">unduh</a>
</div>
<div class="card">
  <h2 class="h4 no-margin">KSEI-9001/DIR/1026</h2>
  <small class="muted"><b>08 Oktober 2026</b></small>
  <p class="no-margin">Pendaftaran NCD IV BANK BJB TAHUN 2026</p>
  <a class="btn btn--primary" href="/Announcement/Files/200400_ksei_9001_dir_1026.pdf">unduh</a>
</div>
<div class="card">
  <h2 class="h4 no-margin">KSEI-7439/DIR/1026 </h2>
  <small class="muted"><b>09 Oktober 2026</b></small>
  <p class="no-margin">Pengumuman KSEI Pendaftaran Produk Investasi di S-INVEST per 09 Oktober 2026</p>
  <a class="btn btn--primary" href="/Announcement/Files/200399_ksei_7439_dir_1026.pdf">unduh</a>
</div>
<div class="card">
  <h2 class="h4 no-margin">KSEI-8000/DIR/1026</h2>
  <small class="muted"><b>07 Oktober 2026</b></small>
  <p class="no-margin">Pendaftaran Waran Terstruktur Seri ABCD</p>
  <a class="btn btn--primary" href="/Announcement/Files/200350_ksei_8000_dir_1026.pdf">unduh</a>
</div>
`

describe('parseNewSecurities', () => {
  it('parses each announcement into ref, ISO date, title, absolute pdf url', async () => {
    const { parseNewSecurities } = await import('./ksei.js')
    const rows = parseNewSecurities(newSecHtml)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({
      ref: 'KSEI-7442/DIR/1026',
      date: '2026-10-09',
      title: 'Pendaftaran Obligasi Berkelanjutan V Sarana Multi Infrastruktur Tahap II Tahun 2026',
      pdfUrl: 'https://web.ksei.co.id/Announcement/Files/200437_ksei_7442_dir_1026_202610091832.pdf',
    })
  })

  it('trims whitespace from the ref number', async () => {
    const { parseNewSecurities } = await import('./ksei.js')
    const rows = parseNewSecurities(newSecHtml)
    expect(rows.find((r) => r.title.includes('S-INVEST'))?.ref).toBe('KSEI-7439/DIR/1026')
  })
})

describe('classifyBondTitle', () => {
  it('classifies obligasi, sukuk, and NCD', async () => {
    const { classifyBondTitle } = await import('./ksei.js')
    expect(classifyBondTitle('Pendaftaran Obligasi Berkelanjutan V Sarana Multi Infrastruktur')).toBe('OBLIGASI')
    expect(classifyBondTitle('Pendaftaran Sukuk Mudharabah Berkelanjutan II')).toBe('SUKUK')
    expect(classifyBondTitle('Pendaftaran NCD IV BANK BJB TAHUN 2026')).toBe('NCD')
  })

  it('rejects warrants, S-INVEST products and mutual funds', async () => {
    const { classifyBondTitle } = await import('./ksei.js')
    expect(classifyBondTitle('Pendaftaran Waran Terstruktur Seri ABCD')).toBeNull()
    expect(classifyBondTitle('Pendaftaran Produk Investasi di S-INVEST per 09 Oktober 2026')).toBeNull()
    expect(classifyBondTitle('Pendaftaran Reksa Dana Pasar Uang')).toBeNull()
  })
})

describe('parseCouponRates', () => {
  // Real extracted text from a KSEI registration PDF (Pindo Deli, 200433).
  const pdfText = `Seri Jumlah Pokok Sebesar Jenis & Tingkat Bunga (Tetap) Frekwensi Pembayaran Bunga Jatuh Tempo Tenor
A Rp918.465.000.000,- 10.00 % p.a Triwulan 27 Oktober 2029 3 Tahun
B Rp97.990.000.000,- 10.50 % p.a Triwulan 27 Oktober 2031 5 Tahun`

  it('extracts every tranche coupon, ignoring nominal amounts and tenor', async () => {
    const { parseCouponRates } = await import('./ksei.js')
    expect(parseCouponRates(pdfText)).toEqual([10.0, 10.5])
  })

  it('handles comma decimal separator', async () => {
    const { parseCouponRates } = await import('./ksei.js')
    expect(parseCouponRates('Seri A 8,75 % p.a')).toEqual([8.75])
  })

  it('returns empty array when no rate is present', async () => {
    const { parseCouponRates } = await import('./ksei.js')
    expect(parseCouponRates('Pendaftaran Obligasi tanpa rincian')).toEqual([])
  })
})
