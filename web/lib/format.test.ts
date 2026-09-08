import { describe, it, expect } from "vitest";
import { fmtIdrCompact, wibDateKey } from "./format";

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
