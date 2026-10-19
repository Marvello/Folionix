import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const auth = vi.fn();
vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));
vi.mock("@/lib/auth", () => ({ auth: () => auth() }));

const { insertStockTransaction, fetchFilteredNews, deleteAccountCharge, promotePeer, saveSetting, resetSetting } = await import("./actions");

const txn = { ticker: "BBCA.JK", side: "BUY", lots: 1, price: 9000, fee: 0, txn_at: "2026-10-06", notes: "" };

describe("server actions", () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    auth.mockReset().mockResolvedValue({ user: { email: "a@b.c" } });
  });

  it("rejects calls without a session and never touches the DB", async () => {
    auth.mockResolvedValue(null);
    await expect(insertStockTransaction(txn)).rejects.toThrow("Unauthorized");
    await expect(deleteAccountCharge(1)).rejects.toThrow("Unauthorized");
    expect(query).not.toHaveBeenCalled();
  });

  it("validates input server-side", async () => {
    await expect(insertStockTransaction({ ...txn, price: -1 })).rejects.toThrow("Invalid price");   // 0 is allowed: bonus shares
    await expect(insertStockTransaction({ ...txn, lots: 1.5 })).rejects.toThrow("Invalid lots");
    await expect(insertStockTransaction({ ...txn, side: "GIFT" })).rejects.toThrow("Invalid side");
    await expect(insertStockTransaction({ ...txn, ticker: "BBCA" })).rejects.toThrow("Invalid ticker");
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses to oversell", async () => {
    query.mockResolvedValueOnce({ rows: [{ lots: 2 }] });
    await expect(insertStockTransaction({ ...txn, side: "SELL", lots: 3 })).rejects.toThrow("only 2 held");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("promotes only peer rows, behind the session + ticker guards", async () => {
    await expect(promotePeer("bbca")).rejects.toThrow("Invalid ticker");
    auth.mockResolvedValueOnce(null);
    await expect(promotePeer("BBCA.JK")).rejects.toThrow("Unauthorized");
    expect(query).not.toHaveBeenCalled();
    await promotePeer("BBCA.JK");
    expect(query.mock.calls[0][0]).toMatch(/SET kind = 'user' WHERE ticker = \$1 AND kind = 'peer'/);
    expect(query.mock.calls[0][1]).toEqual(["BBCA.JK"]);
  });

  it("caps the news page size", async () => {
    await fetchFilteredNews("All", 1_000_000, "2026-01-01T00:00:00Z");
    expect(query.mock.calls[0][1].at(-1)).toBe(200);
  });
});

describe("settings actions", () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    auth.mockReset().mockResolvedValue({ user: { email: "me@x.com" } });
  });

  it("rejects unauthenticated calls", async () => {
    auth.mockResolvedValue(null);
    await expect(saveSetting("GOLD_ALERT_PCT", "4")).rejects.toThrow("Unauthorized");
    expect(query).not.toHaveBeenCalled();
  });

  it("returns validation errors instead of writing", async () => {
    expect(await saveSetting("DATABASE_URL", "x")).toEqual({ error: expect.stringMatching(/Unknown/) });
    expect(await saveSetting("GOLD_ALERT_PCT", "abc")).toEqual({ error: expect.stringMatching(/number/) });
    query.mockResolvedValue({ rows: [{ key: "SIGNAL_PRICE_MAJOR", value: "4" }] });
    expect(await saveSetting("SIGNAL_PRICE_MINOR", "4")).toEqual({ error: expect.stringMatching(/lower/) });
    expect(query.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
  });

  it("upserts the normalised value with the editor's email", async () => {
    expect(await saveSetting("BOND_REG_CHECK_HOURS_WIB", "15,9")).toEqual({});
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO app_settings/.test(sql))!;
    expect(insert[1]).toEqual(["BOND_REG_CHECK_HOURS_WIB", "9,15", "me@x.com"]);
  });

  it("reset deletes the row", async () => {
    expect(await resetSetting("GOLD_ALERT_PCT")).toEqual({});
    expect(query).toHaveBeenLastCalledWith("DELETE FROM app_settings WHERE key = $1", ["GOLD_ALERT_PCT"]);
  });
});
