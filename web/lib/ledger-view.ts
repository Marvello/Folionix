import type { StockTransaction, StockDividend } from "@/lib/types";

const SHARES_PER_LOT = 100;

export type LedgerEntry = {
  key: string;
  date: string;
  type: "BUY" | "SELL" | "DIVIDEND";
  lots: number | null;
  price: number | null;
  fee: number | null;
  amount: number;
};

// One chronological ledger for a ticker: BUY/SELL trades plus dividend payouts,
// newest first. Dividend rows leave lots/price/fee null and carry the payout in
// `amount`; trade rows carry gross trade value in `amount`.
export function mergeTxnLedger(
  txns: StockTransaction[],
  dividends: StockDividend[],
): LedgerEntry[] {
  const rows: LedgerEntry[] = [];
  for (const t of txns) {
    rows.push({
      key: `t${t.id}`,
      date: t.txn_at,
      type: t.side,
      lots: t.lots,
      price: t.price,
      fee: t.fee ?? 0,
      amount: t.price * t.lots * SHARES_PER_LOT,
    });
  }
  for (const d of dividends) {
    rows.push({
      key: `d${d.id}`,
      date: d.paid_at,
      type: "DIVIDEND",
      lots: null,
      price: null,
      fee: null,
      amount: d.amount,
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
