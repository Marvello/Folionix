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
