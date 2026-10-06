import { describe, it, expect } from "vitest";
import { fmtMultiple, fmtQuality, peerMultiple, peerMultipleLabel, peerQuality, type PeerRow, type ValuationResult } from "./peers";

const row = (o: Partial<PeerRow> = {}): PeerRow => ({
  ticker: "BBCA.JK", peer: "BMRI.JK", rank: 1, basis: "sub_industry", group_name: "Bank", name: null,
  market_cap: 1000, trailing_pe: 12, price_to_book: 2.5, total_revenue: 400, ebitda: 100, total_debt: 300, total_cash: 100,
  return_on_equity: 0.218, earnings_growth: 0.05, revenue_growth: 0.1, ebitda_margins: 0.25,
  ...o,
});

describe("peerMultiple (mirrors app/src/ai/valuation.ts multipleOf)", () => {
  it("picks the lens multiple", () => {
    expect(peerMultiple("PB_ROE", row())).toBe(2.5);
    expect(peerMultiple("PB_YIELD", row())).toBe(2.5);
    expect(peerMultiple("PE_GROWTH", row())).toBe(12);
    expect(peerMultiple("PS_GROWTH", row())).toBe(2.5);
  });

  it("EV/EBITDA = (market cap + debt − cash) / EBITDA, current EBITDA for mid-cycle too", () => {
    expect(peerMultiple("EV_EBITDA", row())).toBe(12);
    expect(peerMultiple("EV_EBITDA_MIDCYCLE", row())).toBe(12);
    expect(peerMultiple("EV_EBITDA", row({ total_debt: null, total_cash: null }))).toBe(10);
  });

  it("is null for missing or non-positive inputs", () => {
    expect(peerMultiple("PE_GROWTH", row({ trailing_pe: -4 }))).toBeNull();
    expect(peerMultiple("EV_EBITDA", row({ ebitda: -5 }))).toBeNull();
    expect(peerMultiple("EV_EBITDA", row({ market_cap: null }))).toBeNull();
    expect(peerMultiple("PS_GROWTH", row({ total_revenue: 0 }))).toBeNull();
    expect(peerMultiple("PB_ROE", row({ price_to_book: null }))).toBeNull();
  });
});

describe("peerQuality", () => {
  it("returns the lens's quality metric", () => {
    expect(peerQuality("PB_ROE", row(), null)).toBe(0.218);
    expect(peerQuality("PE_GROWTH", row({ earnings_growth: -0.1 }), null)).toBe(-0.1);
    expect(peerQuality("EV_EBITDA", row(), null)).toBe(0.25);
    expect(peerQuality("EV_EBITDA_MIDCYCLE", row(), null)).toBe(2); // (300 − 100) / 100
    expect(peerQuality("PS_GROWTH", row(), null)).toBe(0.1);
    expect(peerQuality("PB_YIELD", row(), 4.5)).toBe(0.045);
    expect(peerQuality("PB_YIELD", row(), null)).toBeNull();
    expect(peerQuality("EV_EBITDA_MIDCYCLE", row({ ebitda: null }), null)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats multiples and quality, with — for missing", () => {
    expect(fmtMultiple(12.34)).toBe("12.3×");
    expect(fmtMultiple(85336)).toBe("85336×");
    expect(fmtMultiple(null)).toBe("—");
    expect(fmtQuality("PB_ROE", 0.218)).toBe("21.8%");
    expect(fmtQuality("EV_EBITDA_MIDCYCLE", 0.4)).toBe("0.4×");
    expect(fmtQuality("PB_ROE", null)).toBe("—");
  });

  it("labels the mid-cycle peer column as current EV/EBITDA", () => {
    const r = { lens: "EV_EBITDA_MIDCYCLE", multiple_name: "EV/EBITDA (mid-cycle)" } as ValuationResult;
    expect(peerMultipleLabel(r)).toBe("EV/EBITDA (current)");
    expect(peerMultipleLabel({ ...r, lens: "PB_ROE", multiple_name: "P/B" })).toBe("P/B");
  });
});
