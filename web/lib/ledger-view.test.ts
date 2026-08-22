import { describe, it, expect } from "vitest";
import { mergeTxnLedger } from "@/lib/ledger-view";
import type { StockTransaction, StockDividend } from "@/lib/types";

describe("mergeTxnLedger", () => {
  it("merges txns + dividends, newest first", () => {
    const txns: StockTransaction[] = [
      { id: 1, ticker: "BBCA", side: "BUY", lots: 10, price: 5000, fee: 100, txn_at: "2024-01-10T00:00:00Z", notes: null },
      { id: 2, ticker: "BBCA", side: "SELL", lots: 5, price: 6000, fee: 50, txn_at: "2026-05-01T00:00:00Z", notes: null },
    ];
    const divs: StockDividend[] = [
      { id: 9, ticker: "BBCA", amount: 3000, per_share: 20, paid_at: "2025-06-26", notes: null },
    ];
    const out = mergeTxnLedger(txns, divs);
    expect(out.map((r) => r.type)).toEqual(["SELL", "DIVIDEND", "BUY"]);
    expect(out[0].amount).toBe(6000 * 5 * 100);
    expect(out[2].fee).toBe(100);
    const divRow = out.find((r) => r.type === "DIVIDEND")!;
    expect(divRow.lots).toBeNull();
    expect(divRow.price).toBeNull();
    expect(divRow.amount).toBe(3000);
  });
  it("returns empty for no data", () => {
    expect(mergeTxnLedger([], [])).toEqual([]);
  });
});
