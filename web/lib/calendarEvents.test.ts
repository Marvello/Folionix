import { describe, it, expect } from "vitest";
import { buildCalendarEvents } from "./calendarEvents";
import type { BondCouponSchedule, BondHolding, BondCouponPayment, StockTransaction, StockDividend, DividendSchedule, GoldPurchase, FundPurchase, Position } from "./types";

const bondHolding = (over: Partial<BondHolding> = {}): BondHolding => ({
  id: 1, series_type: "CORP", series_code: "INKP05BCN1", platform: "bibit",
  principal: 100_000_000, purchase_price: null, coupon_rate: 10.75,
  maturity_date: "2027-04-22", purchased_at: "2025-04-22T17:00:00+00:00",
  active: true, notes: "", ...over,
});

const sched = (over: Partial<BondCouponSchedule> = {}): BondCouponSchedule => ({
  id: 1, bond_holding_id: 1, series_code: "INKP05BCN1",
  distribution_date: "2026-07-06", status: null, scraped_at: "2026-07-01T00:00:00Z", ...over,
} as BondCouponSchedule);

const base = {
  bondSchedules: [] as BondCouponSchedule[],
  bondHoldings: [] as BondHolding[],
  bondPayments: [] as BondCouponPayment[],
  stockTxns: [] as StockTransaction[],
  stockDividends: [] as StockDividend[],
  dividendSchedule: [] as DividendSchedule[],
  positions: [] as Position[],
  goldPurchases: [] as GoldPurchase[],
  fundPurchases: [] as FundPurchase[],
};

describe("buildCalendarEvents — bond coupons", () => {
  it("prefers last recorded payout as the estimate", () => {
    const events = buildCalendarEvents({
      ...base,
      bondSchedules: [sched()],
      bondHoldings: [bondHolding()],
      bondPayments: [
        { bond_holding_id: 1, paid_at: "2026-04-06", amount: 2_418_750 } as BondCouponPayment,
      ],
    });
    const ev = events.find((e) => e.date === "2026-07-06");
    expect(ev).toMatchObject({ kind: "income", amount: 2_418_750, recorded: false });
    expect(ev!.label).toContain("INKP05BCN1");
  });

  it("skips coupons before the holding purchase (entitlement)", () => {
    const events = buildCalendarEvents({
      ...base,
      bondSchedules: [sched({ distribution_date: "2025-01-06" })],
      bondHoldings: [bondHolding()],
    });
    expect(events.filter((e) => e.kind === "income")).toHaveLength(0);
  });

  it("marks recorded coupons", () => {
    const events = buildCalendarEvents({
      ...base,
      bondSchedules: [sched()],
      bondHoldings: [bondHolding()],
      bondPayments: [
        { bond_holding_id: 1, paid_at: "2026-07-06", amount: 2_418_750 } as BondCouponPayment,
      ],
    });
    expect(events.find((e) => e.kind === "income")!.recorded).toBe(true);
  });
});

describe("buildCalendarEvents — stock transactions", () => {
  it("maps BUY and SELL with transaction value", () => {
    const events = buildCalendarEvents({
      ...base,
      stockTxns: [
        { ticker: "BBCA.JK", side: "BUY", lots: 10, price: 9000, txn_at: "2026-07-01", notes: null },
        { ticker: "GOTO.JK", side: "SELL", lots: 50, price: 60, txn_at: "2026-07-02", notes: null },
      ],
    });
    expect(events).toEqual([
      expect.objectContaining({ date: "2026-07-01", kind: "buy", amount: 9_000_000 }),
      expect.objectContaining({ date: "2026-07-02", kind: "sell", amount: 300_000 }),
    ]);
    expect(events[0].label).toContain("BBCA");
    expect(events[0].label).not.toContain(".JK");
  });

  it("slices timestamps to dates", () => {
    const events = buildCalendarEvents({
      ...base,
      stockTxns: [{ ticker: "TLKM.JK", side: "BUY", lots: 1, price: 2500, txn_at: "2026-07-03T04:00:00+00:00", notes: null }],
    });
    expect(events[0].date).toBe("2026-07-03");
  });
});

describe("buildCalendarEvents — dividends", () => {
  it("recorded dividend → income with actual amount", () => {
    const events = buildCalendarEvents({
      ...base,
      stockDividends: [{ ticker: "BBCA.JK", amount: 450_000, per_share: 45, paid_at: "2026-07-10", notes: null }],
    });
    expect(events[0]).toMatchObject({ date: "2026-07-10", kind: "income", amount: 450_000, recorded: true });
  });

  it("scheduled dividend → estimated from per-share × lots × 100, skipped when already recorded", () => {
    const schedRow: DividendSchedule = {
      ticker: "TLKM.JK", cum_date: null, ex_date: "2026-07-20", recording_date: null,
      pay_date: "2026-08-05", amount_per_share: 100, amount_estimated: false, currency: "IDR",
    };
    const events = buildCalendarEvents({
      ...base,
      dividendSchedule: [schedRow],
      positions: [{ ticker: "TLKM.JK", avg_price: 2500, lots: 5 } as Position],
    });
    expect(events[0]).toMatchObject({ date: "2026-08-05", kind: "income", amount: 50_000, recorded: false });

    const withRecorded = buildCalendarEvents({
      ...base,
      dividendSchedule: [schedRow],
      positions: [{ ticker: "TLKM.JK", avg_price: 2500, lots: 5 } as Position],
      stockDividends: [{ ticker: "TLKM.JK", amount: 49_000, per_share: null, paid_at: "2026-08-05", notes: null }],
    });
    expect(withRecorded.filter((e) => e.date === "2026-08-05")).toHaveLength(1);
    expect(withRecorded[0].amount).toBe(49_000);
  });

  it("scheduled dividend without a position or pay date is skipped", () => {
    const events = buildCalendarEvents({
      ...base,
      dividendSchedule: [
        { ticker: "UNVR.JK", cum_date: null, ex_date: "2026-07-20", recording_date: null, pay_date: "2026-08-05", amount_per_share: 50, amount_estimated: false, currency: "IDR" },
        { ticker: "TLKM.JK", cum_date: null, ex_date: "2026-07-21", recording_date: null, pay_date: null, amount_per_share: 50, amount_estimated: false, currency: "IDR" },
      ],
      positions: [{ ticker: "TLKM.JK", avg_price: 2500, lots: 5 } as Position],
    });
    expect(events).toHaveLength(0);
  });
});

describe("buildCalendarEvents — gold / funds / bond purchases", () => {
  it("gold BUY and SELL", () => {
    const events = buildCalendarEvents({
      ...base,
      goldPurchases: [
        { id: 1, venue: "cermati", grams: 5, buy_price_per_gram: 1_000_000, purchased_at: "2026-07-01", active: true, side: "BUY", notes: "" },
        { id: 2, venue: "cermati", grams: 2, buy_price_per_gram: 1_100_000, purchased_at: "2026-07-05", active: true, side: "SELL", notes: "" },
      ],
    });
    expect(events[0]).toMatchObject({ kind: "buy", amount: 5_000_000 });
    expect(events[1]).toMatchObject({ kind: "sell", amount: 2_200_000 });
    expect(events[0].label).toContain("5g");
  });

  it("fund purchase converts non-IDR via fx map", () => {
    const events = buildCalendarEvents({
      ...base,
      fundPurchases: [
        { id: 1, fund_code: "F1", fund_name: "Fund", platform: "bibit", currency: "USD", units: 10, buy_nav_per_unit: 5, purchased_at: "2026-07-02", active: true, side: "BUY", notes: "" },
      ],
      fxToIdr: new Map([["USD", 18_000]]),
    });
    expect(events[0]).toMatchObject({ kind: "buy", amount: 900_000 });
  });

  it("bond purchase → buy at principal", () => {
    const events = buildCalendarEvents({ ...base, bondHoldings: [bondHolding()] });
    expect(events[0]).toMatchObject({ date: "2025-04-22", kind: "buy", amount: 100_000_000 });
    expect(events[0].label).toContain("INKP05BCN1");
  });
});
