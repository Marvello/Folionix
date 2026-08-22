// lib/coupon.ts
// Bond coupon estimation shared by the backend reminder and the web calendar.
// web/lib/coupon.ts is a verbatim copy (web is isolated from repo-root lib/,
// like ledger.ts) — keep in sync manually.

/** Final withholding tax on bond coupon income (PP 91/2021, from 2026 books). */
export const BOND_COUPON_TAX = 0.10

const FREQUENCIES = [1, 2, 4, 6, 12]

/**
 * Infer coupon payments per year from the spacing of schedule dates.
 * Retail SBN (SR/ORI/SBR/ST) pay monthly; corporate series often quarterly.
 * Defaults to monthly (12) when fewer than 2 dates are known.
 */
export function inferPaymentsPerYear(dates: string[]): number {
  if (dates.length < 2) return 12
  const ts = [...dates].sort().map(d => Date.parse(d))
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 86_400_000).sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  if (!(median > 0)) return 12
  let best = 12
  for (const f of FREQUENCIES) {
    if (Math.abs(365.25 / f - median) < Math.abs(365.25 / best - median)) best = f
  }
  return best
}

/** Per-period coupon estimate, net of final tax. */
export function estimateCouponNet(principal: number, couponRatePct: number, paymentsPerYear: number): number {
  return principal * (couponRatePct / 100) / paymentsPerYear * (1 - BOND_COUPON_TAX)
}

/**
 * Most recent recorded coupon amount per holding — the best estimator for the
 * next payout (actual cadence, tax, and rounding already baked in).
 */
export function latestPaymentByHolding(
  payments: Array<{ bond_holding_id: number; paid_at: string; amount: number | null }>,
): Map<number, number> {
  const latest = new Map<number, { paid_at: string; amount: number }>()
  for (const p of payments) {
    if (p.amount == null) continue
    const cur = latest.get(p.bond_holding_id)
    if (!cur || p.paid_at > cur.paid_at) latest.set(p.bond_holding_id, { paid_at: p.paid_at, amount: p.amount })
  }
  return new Map([...latest].map(([id, v]) => [id, v.amount]))
}
