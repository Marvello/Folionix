import { getPool } from "@/lib/db";
import type { GoldPurchase, GoldPrice } from "@/lib/types";
import type { ChartPoint } from "@/lib/chart";
import GoldClient from "@/components/GoldClient";

export default async function GoldPage() {
  const pool = getPool();
  const [purRes, priceRes, histRes] = await Promise.all([
    pool.query("SELECT * FROM gold_purchases WHERE active = true ORDER BY purchased_at DESC"),
    pool.query("SELECT * FROM latest_gold_prices"),
    // Sell-back price history per venue — the price holdings are valued at.
    pool.query(
      "SELECT venue, sell_price, fetched_at FROM gold_snapshots WHERE sell_price IS NOT NULL ORDER BY fetched_at ASC",
    ),
  ]);

  const history: Record<string, ChartPoint[]> = {};
  for (const r of histRes.rows as { venue: string; sell_price: number; fetched_at: string }[]) {
    (history[r.venue] ??= []).push({ t: r.fetched_at, price: r.sell_price });
  }

  return (
    <GoldClient
      purchases={purRes.rows as GoldPurchase[]}
      prices={priceRes.rows as GoldPrice[]}
      history={history}
    />
  );
}
