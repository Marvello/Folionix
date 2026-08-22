import { describe, it, expect } from 'vitest'
import { inferPaymentsPerYear, estimateCouponNet, latestPaymentByHolding } from './coupon'

// Real INKP05BCN1 KSEI schedule — quarterly corporate bond
const quarterly = [
  '2025-01-06', '2025-04-08', '2025-07-04', '2025-10-06',
  '2026-01-05', '2026-04-06', '2026-07-06',
]
// Monthly retail SBN cadence (ORI-style, pay-date drift over weekends)
const monthly = [
  '2026-01-15', '2026-02-18', '2026-03-16', '2026-04-15',
  '2026-05-18', '2026-06-15', '2026-07-15',
]

describe('inferPaymentsPerYear', () => {
  it('detects quarterly cadence from schedule gaps', () => {
    expect(inferPaymentsPerYear(quarterly)).toBe(4)
  })

  it('detects monthly cadence', () => {
    expect(inferPaymentsPerYear(monthly)).toBe(12)
  })

  it('defaults to monthly when fewer than 2 dates', () => {
    expect(inferPaymentsPerYear([])).toBe(12)
    expect(inferPaymentsPerYear(['2026-07-06'])).toBe(12)
  })

  it('is order-insensitive', () => {
    expect(inferPaymentsPerYear([...quarterly].reverse())).toBe(4)
  })
})

describe('estimateCouponNet', () => {
  it('INKP05BCN1: 100jt @ 10.75% quarterly, net of 10% tax = 2,418,750', () => {
    expect(estimateCouponNet(100_000_000, 10.75, 4)).toBeCloseTo(2_418_750, 0)
  })

  it('ORI027T3: 100jt @ 6.65% monthly, net of 10% tax = 498,750', () => {
    expect(estimateCouponNet(100_000_000, 6.65, 12)).toBeCloseTo(498_750, 0)
  })
})

describe('latestPaymentByHolding', () => {
  it('keeps the most recent amount per holding', () => {
    const m = latestPaymentByHolding([
      { bond_holding_id: 1, paid_at: '2026-04-06', amount: 2_418_750 },
      { bond_holding_id: 1, paid_at: '2025-07-04', amount: 2_475_486 },
      { bond_holding_id: 6, paid_at: '2026-06-10', amount: 663_795 },
      { bond_holding_id: 6, paid_at: '2026-05-11', amount: 398_250 },
    ])
    expect(m.get(1)).toBe(2_418_750)
    expect(m.get(6)).toBe(663_795)
  })

  it('ignores null amounts', () => {
    const m = latestPaymentByHolding([
      { bond_holding_id: 1, paid_at: '2026-07-06', amount: null },
      { bond_holding_id: 1, paid_at: '2026-04-06', amount: 2_418_750 },
    ])
    expect(m.get(1)).toBe(2_418_750)
  })
})
