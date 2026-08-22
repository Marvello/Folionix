import { describe, it, expect } from "vitest";
import { positionMetrics } from "@/lib/position";
import type { Position, StockDividend } from "@/lib/types";

const pos = (o: Partial<Position> = {}): Position => ({
  ticker: "BBCA", avg_price: 5725, lots: 65, active: true,
  notes: null, realized_pnl: 0, updated_at: null, ...o,
});
const div = (amount: number): StockDividend => ({
  ticker: "BBCA", amount, per_share: null, paid_at: "2026-01-01", notes: null,
});

describe("positionMetrics", () => {
  it("computes cost, value, unrealized P&L when priced", () => {
    const m = positionMetrics(pos(), 8150, []);
    expect(m.costBasis).toBe(5725 * 6500);
    expect(m.marketValue).toBe(8150 * 6500);
    expect(m.unrealizedPnl).toBe((8150 - 5725) * 6500);
    expect(m.unrealizedPct).toBeCloseTo(((8150 - 5725) / 5725) * 100, 4);
  });
  it("nulls pct and zeroes value when no price", () => {
    const m = positionMetrics(pos(), null, []);
    expect(m.marketValue).toBe(0);
    expect(m.unrealizedPnl).toBe(0);
    expect(m.unrealizedPct).toBeNull();
  });
  it("sums dividend income into total return", () => {
    const m = positionMetrics(pos({ realized_pnl: 1000 }), 8150, [div(3000), div(785000)]);
    expect(m.income).toBe(788000);
    expect(m.totalReturn).toBe(m.unrealizedPnl + 1000 + 788000);
  });
});
