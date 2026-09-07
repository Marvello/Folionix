import { describe, it, expect } from "vitest";
import { resolveTab, DETAIL_TABS } from "@/lib/tabs";

describe("resolveTab", () => {
  it("defaults to overview when absent", () => {
    expect(resolveTab(undefined)).toBe("overview");
  });

  it("accepts every declared tab id", () => {
    for (const t of DETAIL_TABS) expect(resolveTab(t.id)).toBe(t.id);
  });

  it("falls back to overview for an unknown or hostile value", () => {
    expect(resolveTab("financialz")).toBe("overview");
    expect(resolveTab("../../etc/passwd")).toBe("overview");
    expect(resolveTab("")).toBe("overview");
  });
});
