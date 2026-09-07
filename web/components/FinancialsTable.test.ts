import { describe, it, expect } from "vitest";
import { showEpsColumn } from "./FinancialsTable";
import type { StockFinancialRow } from "@/lib/types";

const row = (eps: number | null): StockFinancialRow => ({
  ticker: "BBCA.JK",
  period_end: "2026-06-30",
  period_type: "QUARTERLY",
  revenue: 1,
  net_income: 1,
  net_margin_pct: 1,
  eps,
  currency: "IDR",
  fetched_at: "2026-09-07T00:00:00Z",
} as unknown as StockFinancialRow);

describe("showEpsColumn", () => {
  it("is false when every row has a null eps (e.g. BBCA quarters from yahoo)", () => {
    expect(showEpsColumn([row(null), row(null), row(null), row(null)])).toBe(false);
  });
  it("is true when at least one row has a non-null eps", () => {
    expect(showEpsColumn([row(null), row(1.23), row(null)])).toBe(true);
  });
});
