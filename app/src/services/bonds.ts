// app/src/services/bonds.ts
import {
  getBondHoldings, saveBondCouponPayment, upsertBondCouponSchedule,
  getBondScheduleForDate, getBondCouponScheduleDates, getBondCouponPaymentRows,
} from '../db/db'
import { fetchCouponSchedule } from '../providers/ksei'
import { sendTelegram } from '../telegram/client'
import { fmtIdr, WIB } from '../../../lib/format'
import { estimateCouponNet, inferPaymentsPerYear, latestPaymentByHolding, BOND_COUPON_TAX } from '../../../lib/coupon'
import type { BondHoldingRow } from '../../../lib/types'

export interface BondSummary {
  holding: BondHoldingRow
  daysToMaturity: number
  /** Annual coupon income, net of the 10% final withholding tax — consistent
   *  with the per-period coupon reminders (estimateCouponNet). */
  annualCouponIncome: number
}

export async function listBondHoldings(): Promise<BondSummary[]> {
  const holdings = await getBondHoldings()
  const now = new Date()

  return holdings.map(h => {
    const maturity = new Date(h.maturity_date)
    const daysToMaturity = Math.max(0, Math.round((maturity.getTime() - now.getTime()) / 86_400_000))
    const annualCouponIncome = h.principal * (h.coupon_rate / 100) * (1 - BOND_COUPON_TAX)
    return { holding: h, daysToMaturity, annualCouponIncome }
  })
}

export async function syncBondCouponSchedules(): Promise<void> {
  const holdings = await getBondHoldings()
  for (const h of holdings) {
    // KSEI lists both government (SR/ORI/SBR/ST) and corporate series; the
    // provider picks the right page per code. Attempt every holding — series
    // with no listed coupon action just return [] and no-op.
    try {
      const schedule = await fetchCouponSchedule(h.series_code)
      if (schedule.length > 0 && h.id != null) {
        await upsertBondCouponSchedule(h.id, h.series_code, schedule)
      } else {
        console.warn(`[bonds] ${h.series_code}: no KSEI coupon rows found — skipping`)
      }
    } catch (err) {
      console.error(`[bonds] KSEI sync failed for ${h.series_code}:`, err)
    }
  }
}

export async function recordCouponPayment(
  bondId: number, paidAt: string, amount: number,
): Promise<void> {
  await saveBondCouponPayment(bondId, paidAt, amount)
}

/** WIB (UTC+7) calendar date `days` from now, as YYYY-MM-DD. */
function wibDateOffset(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: WIB })
}

/**
 * H-1 reminder: if any active, entitled holding has a coupon distribution
 * tomorrow (WIB), send a Telegram heads-up with an estimated amount per series.
 * No-op when nothing is due. Amounts are estimates — KSEI does not expose the
 * per-unit coupon, so we use the last recorded payout per holding, falling back
 * to the coupon rate at the cadence inferred from the schedule.
 */
export async function sendCouponReminders(): Promise<void> {
  const date = wibDateOffset(1)
  const rows = await getBondScheduleForDate(date)
  if (rows.length === 0) return

  const byId = new Map((await getBondHoldings()).map(h => [h.id, h]))

  // Best estimate per holding: last recorded payout (actual cadence + tax baked
  // in), else rate-derived net using cadence inferred from the schedule spacing.
  const latestPay = latestPaymentByHolding(await getBondCouponPaymentRows())
  const datesByHolding = new Map<number, string[]>()
  for (const s of await getBondCouponScheduleDates()) {
    const list = datesByHolding.get(s.bond_holding_id) ?? []
    list.push(s.distribution_date)
    datesByHolding.set(s.bond_holding_id, list)
  }

  const bySeries = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const h = byId.get(r.bond_holding_id)
    if (!h || !h.active) continue
    // Bought after the distribution date → prior holder was entitled, skip.
    if (h.purchased_at && h.purchased_at.slice(0, 10) > date) continue
    const est = latestPay.get(r.bond_holding_id)
      ?? estimateCouponNet(h.principal, h.coupon_rate, inferPaymentsPerYear(datesByHolding.get(r.bond_holding_id) ?? []))
    const cur = bySeries.get(h.series_code) ?? { total: 0, count: 0 }
    cur.total += est
    cur.count += 1
    bySeries.set(h.series_code, cur)
  }
  if (bySeries.size === 0) return

  let grand = 0
  const lines = [...bySeries.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([series, v]) => {
      grand += v.total
      return `<b>${series}</b> · ~${fmtIdr(v.total)}${v.count > 1 ? ` (${v.count} holdings)` : ''}`
    })

  await sendTelegram(
    `🔔 <b>Coupon payment tomorrow — ${date}</b>\n\n` +
    lines.join('\n') +
    `\n\nTotal est. ~${fmtIdr(grand)}\n<i>Estimate from coupon rate — confirm actual on payout.</i>`,
  )
}
