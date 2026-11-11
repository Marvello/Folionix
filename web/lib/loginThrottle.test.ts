import { describe, it, expect } from "vitest";
import { isLocked, recordFailure, clearFailures, tryAttempt } from "./loginThrottle";

describe("loginThrottle", () => {
  it("admits only 5 of a concurrent burst (attempts reserved before bcrypt)", () => {
    const keys = ["email:burst@x", "ip:9.9.9.9"];
    const admitted = Array.from({ length: 20 }, () => tryAttempt(keys, 1_000)).filter(Boolean).length;
    expect(admitted).toBe(5);
    clearFailures(keys[0]); // a correct guess among the 5 clears its own key
    expect(tryAttempt(keys, 1_001)).toBe(false); // IP still locked
  });

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
