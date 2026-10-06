import { describe, it, expect } from "vitest";
import { isLocked, recordFailure, clearFailures } from "./loginThrottle";

describe("loginThrottle", () => {
  it("locks a key after 5 failures in the window, then unlocks", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) recordFailure("a@b.c", t0 + i);
    expect(isLocked("a@b.c", t0 + 5)).toBe(false);
    recordFailure("a@b.c", t0 + 5);
    expect(isLocked("a@b.c", t0 + 6)).toBe(true);
    expect(isLocked("a@b.c", t0 + 16 * 60_000)).toBe(false);
  });

  it("forgets failures outside the window and on success", () => {
    for (let i = 0; i < 4; i++) recordFailure("x", i);
    recordFailure("x", 20 * 60_000);   // window expired → counter restarts
    expect(isLocked("x", 20 * 60_000 + 1)).toBe(false);
    clearFailures("x");
    expect(isLocked("x")).toBe(false);
  });
});
