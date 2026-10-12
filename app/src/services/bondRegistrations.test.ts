import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/db.js', () => ({
  countBondRegistrations: vi.fn(),
  selectKnownRegistrationRefs: vi.fn(),
  insertBondRegistration: vi.fn(),
}))
vi.mock('../providers/ksei.js', () => ({
  fetchNewSecurities: vi.fn(),
  fetchCoupon: vi.fn(),
}))
vi.mock('../telegram/client.js', () => ({ sendTelegram: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  process.env.SEND_TELEGRAM = 'true'
  process.env.BOND_ALERT_MIN_COUPON_PCT = '9'
})

const bond = (ref: string, over = {}) => ({
  ref,
  date: '2026-10-09',
  title: `Pendaftaran Obligasi ${ref}`,
  pdfUrl: `https://web.ksei.co.id/Announcement/Files/${ref}.pdf`,
  kind: 'OBLIGASI' as const,
  ...over,
})

describe('checkNewBondRegistrations', () => {
  it('seeds silently on first run (empty table): stores all, no PDF fetch, no alert', async () => {
    const db = await import('../db/db.js')
    const ksei = await import('../providers/ksei.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(db.countBondRegistrations).mockResolvedValue(0)
    vi.mocked(ksei.fetchNewSecurities).mockResolvedValue([bond('A'), bond('B')])

    const { checkNewBondRegistrations } = await import('./bonds.js')
    await checkNewBondRegistrations()

    expect(db.insertBondRegistration).toHaveBeenCalledTimes(2)
    expect(ksei.fetchCoupon).not.toHaveBeenCalled()
    expect(sendTelegram).not.toHaveBeenCalled()
  })

  it('alerts only new bonds whose max coupon exceeds the threshold', async () => {
    const db = await import('../db/db.js')
    const ksei = await import('../providers/ksei.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(db.countBondRegistrations).mockResolvedValue(5)
    vi.mocked(db.selectKnownRegistrationRefs).mockResolvedValue(['C'])
    vi.mocked(ksei.fetchNewSecurities).mockResolvedValue([bond('A'), bond('B'), bond('C')])
    vi.mocked(ksei.fetchCoupon).mockImplementation(async (url: string) =>
      url.includes('/A.pdf') ? 10.5 : 7.0,
    )

    const { checkNewBondRegistrations } = await import('./bonds.js')
    await checkNewBondRegistrations()

    // Known ref C is skipped entirely; A and B are fetched + stored.
    expect(ksei.fetchCoupon).toHaveBeenCalledTimes(2)
    expect(db.insertBondRegistration).toHaveBeenCalledTimes(2)
    // Only A (10.5 > 9) alerts; B (7.0) does not.
    expect(sendTelegram).toHaveBeenCalledTimes(1)
    const msg = vi.mocked(sendTelegram).mock.calls[0][0]
    expect(msg).toContain('Obligasi A')
    expect(msg).toContain('10.5')
  })

  it('alerts a new bond with an unparseable coupon, flagged unknown', async () => {
    const db = await import('../db/db.js')
    const ksei = await import('../providers/ksei.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(db.countBondRegistrations).mockResolvedValue(5)
    vi.mocked(db.selectKnownRegistrationRefs).mockResolvedValue([])
    vi.mocked(ksei.fetchNewSecurities).mockResolvedValue([bond('D')])
    vi.mocked(ksei.fetchCoupon).mockResolvedValue(null)

    const { checkNewBondRegistrations } = await import('./bonds.js')
    await checkNewBondRegistrations()

    expect(sendTelegram).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendTelegram).mock.calls[0][0].toLowerCase()).toContain('unknown')
  })

  it('does not send when SEND_TELEGRAM=false', async () => {
    process.env.SEND_TELEGRAM = 'false'
    const db = await import('../db/db.js')
    const ksei = await import('../providers/ksei.js')
    const { sendTelegram } = await import('../telegram/client.js')
    vi.mocked(db.countBondRegistrations).mockResolvedValue(5)
    vi.mocked(db.selectKnownRegistrationRefs).mockResolvedValue([])
    vi.mocked(ksei.fetchNewSecurities).mockResolvedValue([bond('E')])
    vi.mocked(ksei.fetchCoupon).mockResolvedValue(12)

    const { checkNewBondRegistrations } = await import('./bonds.js')
    await checkNewBondRegistrations()

    expect(db.insertBondRegistration).toHaveBeenCalledTimes(1)
    expect(sendTelegram).not.toHaveBeenCalled()
  })
})
