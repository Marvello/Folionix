import { describe, it, expect } from "vitest";
import { nextSort, compareBy } from "./useSort";

describe("nextSort", () => {
  it("flips the active column", () => {
    expect(nextSort({ col: "pnl", dir: "desc" }, "pnl")).toEqual({ col: "pnl", dir: "asc" });
    expect(nextSort({ col: "pnl", dir: "asc" }, "pnl")).toEqual({ col: "pnl", dir: "desc" });
  });
  it("starts a new numeric column desc and a text column asc", () => {
    expect(nextSort({ col: "pnl", dir: "asc" }, "cost")).toEqual({ col: "cost", dir: "desc" });
    expect(nextSort({ col: "pnl", dir: "desc" }, "ticker", ["ticker"])).toEqual({ col: "ticker", dir: "asc" });
  });
});

describe("compareBy", () => {
  it("orders numbers by direction", () => {
    expect([3, 1, 2].sort((a, b) => compareBy(a, b, "asc"))).toEqual([1, 2, 3]);
    expect([3, 1, 2].sort((a, b) => compareBy(a, b, "desc"))).toEqual([3, 2, 1]);
  });
  it("treats null as lowest and never returns NaN", () => {
    expect([null, 5].sort((a, b) => compareBy(a, b, "desc"))).toEqual([5, null]);
    expect(compareBy(null, null, "asc")).toBe(0);
  });
  it("compares strings", () => {
    expect(["b", "a"].sort((a, b) => compareBy(a, b, "asc"))).toEqual(["a", "b"]);
  });
});
