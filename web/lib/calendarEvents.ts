// Builds the flat event list behind the dashboard activity calendar: bond
// coupons + stock dividends (income), and every buy/sell across stocks, gold,
// funds, and bonds. Pure — rows in, events out.
import { estimateCouponNet, inferPaymentsPerYear, latestPaymentByHolding } from "@folionix/lib";
import { displayTicker, fmtIdr } from "./format";
import type {
  BondCouponSchedule, BondHolding, BondCouponPayment,
  StockTransaction, StockDividend, DividendSchedule, Position,
  GoldPurchase, FundPurchase,
} from "./types";

export type CalendarEventKind = "income" | "buy" | "sell";

export type CalendarEvent = {
  date: string; // YYYY-MM-DD
  kind: CalendarEventKind;
  label: string;
  amount: number | null; // IDR; null when unknown
  /** Income only: actual payout logged (true) vs estimate (false). */
  recorded?: boolean;
};

const day = (v: string) => v.slice(0, 10);
const side = (s: "BUY" | "SELL" | undefined): CalendarEventKind => (s === "SELL" ? "sell" : "buy");

export function buildCalendarEvents({
  bondSchedules,
  bondHoldings,
  bondPayments,
  stockTxns,
  stockDividends,
  dividendSchedule,
  positions,
  goldPurchases,
  fundPurchases,
  fxToIdr,
}: {
  bondSchedules: BondCouponSchedule[];
  bondHoldings: BondHolding[];
  bondPayments: BondCouponPayment[];
  stockTxns: StockTransaction[];
  stockDividends: StockDividend[];
  dividendSchedule: DividendSchedule[];
  positions: Position[];
  goldPurchases: GoldPurchase[];
  fundPurchases: FundPurchase[];
  fxToIdr?: Map<string, number>;
}): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  // ── BOND COUPONS (income) ──
  const holdingById = new Map(bondHoldings.map((h) => [h.id, h]));
  const recordedCoupons = new Set<string>();
  for (const p of bondPayments) {
    const h = holdingById.get(p.bond_holding_id);
    if (h) recordedCoupons.add(`${h.series_code}|${p.paid_at}`);
  }
  const latestPay = latestPaymentByHolding(bondPayments);
  const datesByHolding = new Map<number, string[]>();
  for (const s of bondSchedules) {
    const list = datesByHolding.get(s.bond_holding_id) ?? [];
    list.push(s.distribution_date);
    datesByHolding.set(s.bond_holding_id, list);
  }
  // Aggregate per (date, series): several holdings of one series pay together.
  const couponAgg = new Map<string, { date: string; series: string; est: number; recorded: boolean }>();
  for (const s of bondSchedules) {
    const h = holdingById.get(s.bond_holding_id);
    if (!h || !h.active) continue;
    if (h.purchased_at && day(h.purchased_at) > s.distribution_date) continue; // not entitled yet
    const est = latestPay.get(s.bond_holding_id)
      ?? (h.coupon_rate
        ? estimateCouponNet(h.principal, h.coupon_rate, inferPaymentsPerYear(datesByHolding.get(s.bond_holding_id) ?? []))
        : 0);
    const key = `${s.distribution_date}|${s.series_code}`;
    const cur = couponAgg.get(key) ?? {
      date: s.distribution_date, series: s.series_code, est: 0,
      recorded: recordedCoupons.has(`${s.series_code}|${s.distribution_date}`),
    };
    cur.est += est;
    couponAgg.set(key, cur);
  }
  for (const c of couponAgg.values()) {
    events.push({ date: c.date, kind: "income", label: `${c.series} coupon`, amount: c.est || null, recorded: c.recorded });
  }

  // ── STOCK DIVIDENDS (income): actuals first, then unrecorded scheduled ──
  const recordedDividends = new Set<string>();
  for (const d of stockDividends) {
    recordedDividends.add(`${d.ticker}|${day(d.paid_at)}`);
    events.push({
      date: day(d.paid_at), kind: "income",
      label: `${displayTicker(d.ticker)} dividend`, amount: d.amount, recorded: true,
    });
  }
  const lotsByTicker = new Map(positions.map((p) => [p.ticker, p.lots]));
  for (const s of dividendSchedule) {
    if (!s.pay_date) continue;
    const lots = lotsByTicker.get(s.ticker);
    if (!lots) continue; // not held — not entitled
    if (recordedDividends.has(`${s.ticker}|${s.pay_date}`)) continue; // actual already logged
    const amount = s.amount_per_share != null ? s.amount_per_share * lots * 100 : null;
    events.push({
      date: s.pay_date, kind: "income",
      label: `${displayTicker(s.ticker)} dividend`, amount, recorded: false,
    });
  }

  // ── STOCK TRANSACTIONS ──
  for (const t of stockTxns) {
    events.push({
      date: day(t.txn_at), kind: side(t.side),
      label: `${t.side} ${t.lots} lot ${displayTicker(t.ticker)}`,
      amount: t.lots * 100 * t.price,
    });
  }

  // ── GOLD ──
  for (const g of goldPurchases) {
    events.push({
      date: day(g.purchased_at), kind: side(g.side),
      label: `${g.side ?? "BUY"} gold ${g.grams}g`,
      amount: g.grams * g.buy_price_per_gram,
    });
  }

  // ── FUNDS ──
  for (const f of fundPurchases) {
    const rate = f.currency === "IDR" ? 1 : fxToIdr?.get(f.currency);
    events.push({
      date: day(f.purchased_at), kind: side(f.side),
      label: `${f.side ?? "BUY"} ${f.fund_code}`,
      amount: rate != null ? f.units * f.buy_nav_per_unit * rate : null,
    });
  }

  // ── BOND PURCHASES ──
  for (const h of bondHoldings) {
    if (!h.active) continue;
    events.push({
      date: day(h.purchased_at), kind: "buy",
      label: `BUY ${h.series_code}`, amount: h.principal,
    });
  }

  return events;
}

/** Short tooltip amount, e.g. "~Rp 2,4 jt" for estimates. */
export function fmtEventAmount(e: CalendarEvent): string | null {
  if (e.amount == null) return null;
  const prefix = e.kind === "income" && !e.recorded ? "~" : "";
  return `${prefix}${fmtIdr(e.amount)}`;
}
