import { describe, it, expect } from "vitest";
import { filterByRange, availableRanges, defaultRange, rangeCutoff, type ChartPoint } from "@/lib/chart";

const NOW = new Date("2026-07-09T00:00:00Z");
const pt = (t: string, price = 100): ChartPoint => ({ t, price });

describe("chart range helpers", () => {
  it("rangeCutoff subtracts months, null for ALL", () => {
    expect(rangeCutoff("ALL", NOW)).toBeNull();
    expect(rangeCutoff("3M", NOW)!.toISOString()).toBe(new Date("2026-04-09T00:00:00Z").toISOString());
  });
  it("filterByRange keeps points within cutoff", () => {
    const pts = [pt("2025-01-01T00:00:00Z"), pt("2026-06-01T00:00:00Z"), pt("2026-07-01T00:00:00Z")];
    expect(filterByRange(pts, "3M", NOW).length).toBe(2);
    expect(filterByRange(pts, "ALL", NOW).length).toBe(3);
  });
  it("availableRanges lists only ranges with >=2 points", () => {
    const recent = [pt("2026-07-07T00:00:00Z"), pt("2026-07-09T00:00:00Z")];
    const av = availableRanges(recent, NOW);
    expect(av).toContain("1M");
    expect(av).toContain("ALL");
  });
  it("defaultRange is 6M when history spans >=6mo else ALL", () => {
    const longHist = [pt("2025-01-01T00:00:00Z"), pt("2026-07-01T00:00:00Z")];
    expect(defaultRange(longHist, NOW)).toBe("6M");
    const shortHist = [pt("2026-06-01T00:00:00Z"), pt("2026-07-01T00:00:00Z")];
    expect(defaultRange(shortHist, NOW)).toBe("ALL");
  });
});
