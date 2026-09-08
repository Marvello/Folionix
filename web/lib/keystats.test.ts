import { describe, it, expect } from "vitest";
import { statGroups } from "./keystats";
import type { StockKeyStatsRow } from "@/lib/types";

const sparse = { ticker: "BSSR.JK", fetched_at: "2026-09-07T00:00:00Z", price_to_book: 2.7 } as StockKeyStatsRow;

describe("statGroups", () => {
  it("drops empty groups entirely rather than rendering a wall of N/A", () => {
    const groups = statGroups(sparse);
    expect(groups.map((g) => g.label)).toContain("Valuation");
    expect(groups.map((g) => g.label)).not.toContain("Street");
    expect(groups.map((g) => g.label)).not.toContain("Ownership");
  });

  it("keeps only the populated stats within a surviving group", () => {
    const valuation = statGroups(sparse).find((g) => g.label === "Valuation")!;
    expect(valuation.stats.map((s) => s.label)).toEqual(["P/B"]);
  });

  it("renders every group when the payload is full", () => {
    const full = { ...sparse, forward_pe: 19.8, target_mean: 8194, analyst_count: 25,
                   return_on_equity: 0.182, held_pct_insiders: 0.549, current_ratio: 1.24 } as StockKeyStatsRow;
    expect(statGroups(full).map((g) => g.label))
      .toEqual(["Valuation", "Profitability", "Health", "Street", "Ownership"]);
  });

  it("renders large rupiah magnitudes compactly, and share counts with no currency code (regression for defect B)", () => {
    const full = {
      ...sparse,
      enterprise_value: 797272631672832,
      shares_outstanding: 122876240600,
    } as StockKeyStatsRow;
    const groups = statGroups(full);
    const ev = groups.find((g) => g.label === "Valuation")!.stats.find((s) => s.label === "EV")!;
    expect(ev.value).toBe("IDR 797.27T");
    const sharesOut = groups.find((g) => g.label === "Ownership")!.stats.find((s) => s.label === "Shares out")!;
    expect(sharesOut.value).toBe("122.88B");
    expect(sharesOut.value).not.toContain("IDR");
    expect(sharesOut.value).not.toContain("Rp");
  });
});
