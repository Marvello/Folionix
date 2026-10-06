import { describe, it, expect } from "vitest";
import { fmtIdrCompact, fmtIdr, fmtCurrency, fmtSigned, fmtPctAbs, wibDateKey } from "./format";

describe("fmtIdrCompact", () => {
  it("scales trillions with an explicit IDR code", () => {
    expect(fmtIdrCompact(797272631672832)).toBe("IDR 797.27T");
  });
  it("scales another trillions figure", () => {
    expect(fmtIdrCompact(78018609414144)).toBe("IDR 78.02T");
  });
  it("scales millions", () => {
    expect(fmtIdrCompact(1234567)).toBe("IDR 1.23M");
  });
  it("uses the K tier below 1M", () => {
    expect(fmtIdrCompact(12500)).toBe("IDR 12.5K");
  });
  it("spells small amounts out in full", () => {
    expect(fmtIdrCompact(450)).toBe("IDR 450");
  });
  it("returns N/A for null/undefined", () => {
    expect(fmtIdrCompact(null)).toBe("N/A");
    expect(fmtIdrCompact(undefined)).toBe("N/A");
  });
  it("keeps the sign on a negative value", () => {
    expect(fmtIdrCompact(-5_000_000_000)).toBe("-IDR 5.00B");
  });
  it("formats a share count with no currency code when the prefix is empty", () => {
    const out = fmtIdrCompact(122876240600, "");
    expect(out).toBe("122.88B");
    expect(out).not.toContain("IDR");
    expect(out).not.toContain("Rp");
  });
});

describe("wibDateKey", () => {
  it("is already tomorrow in WIB during the evening UTC", () => {
    // 18:00 UTC is 01:00 WIB the next day - the UTC date is a day behind.
    expect(wibDateKey(new Date("2026-09-07T18:00:00Z"))).toBe("2026-09-08");
  });
  it("agrees with the UTC date during WIB daylight hours", () => {
    expect(wibDateKey(new Date("2026-09-07T05:00:00Z"))).toBe("2026-09-07");
  });
});

describe("money locale + signed deltas", () => {
  it("formats IDR with en-US separators and the sign before the code", () => {
    expect(fmtIdr(12450000)).toBe("IDR 12,450,000");
    expect(fmtIdr(-1234)).toBe("-IDR 1,234");
    expect(fmtIdr(1234.5, 2)).toBe("IDR 1,234.50");
    expect(fmtIdr(null)).toBe("N/A");
  });
  it("formats other currencies with 2 dp", () => {
    expect(fmtCurrency(1234.5, "USD")).toBe("USD 1,234.50");
  });
  it("signs money, compact and percent consistently", () => {
    expect(fmtSigned(1234, fmtIdr)).toBe("+IDR 1,234");
    expect(fmtSigned(-1234, fmtIdr)).toBe("-IDR 1,234");
    expect(fmtSigned(-5_000_000_000, fmtIdrCompact)).toBe("-IDR 5.00B");
    expect(fmtSigned(2.456)).toBe("+2.5%");
    expect(fmtSigned(-0.79, fmtPctAbs(2))).toBe("-0.79%");
  });
  it("gives no sign to a value that rounds to zero", () => {
    expect(fmtSigned(0, fmtIdr)).toBe("IDR 0");
    expect(fmtSigned(-0.4, fmtIdr)).toBe("IDR 0");
    expect(fmtSigned(-0.01)).toBe("0.0%");
  });
});

describe("tone", () => {
  it("keeps zero neutral", async () => {
    const { tone } = await import("./format");
    expect([tone(5), tone(-1), tone(0), tone(1e-9), tone(null)]).toEqual(["up", "down", undefined, undefined, undefined]);
  });
});
