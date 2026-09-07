import { describe, it, expect } from "vitest";
import { fmtIdrMagnitude, fmtCountCompact } from "./format";

describe("fmtIdrMagnitude", () => {
  it("scales trillions with an explicit IDR code", () => {
    expect(fmtIdrMagnitude(797272631672832)).toBe("IDR 797,27T");
  });
  it("scales another trillions figure", () => {
    expect(fmtIdrMagnitude(78018609414144)).toBe("IDR 78,02T");
  });
  it("scales millions", () => {
    expect(fmtIdrMagnitude(1234567)).toBe("IDR 1,23M");
  });
  it("falls through to fmtIdr below 1M", () => {
    expect(fmtIdrMagnitude(12450)).toBe("IDR 12.450");
  });
  it("returns null for null/undefined", () => {
    expect(fmtIdrMagnitude(null)).toBeNull();
    expect(fmtIdrMagnitude(undefined)).toBeNull();
  });
  it("keeps the sign on a negative value", () => {
    expect(fmtIdrMagnitude(-5_000_000_000)).toBe("-IDR 5,00B");
  });
});

describe("fmtCountCompact", () => {
  it("formats a share count compactly with no currency code", () => {
    const out = fmtCountCompact(122876240600);
    expect(out).toBe("122,88B");
    expect(out).not.toContain("IDR");
    expect(out).not.toContain("Rp");
  });
});
