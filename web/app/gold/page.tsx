import { getPool } from "@/lib/db";
import type { GoldPurchase, GoldPrice } from "@/lib/types";
import GoldClient from "@/components/GoldClient";

export default async function GoldPage() {
  const pool = getPool();
  const [purRes, priceRes] = await Promise.all([
    pool.query("SELECT * FROM gold_purchases WHERE active = true ORDER BY purchased_at DESC"),
    pool.query("SELECT * FROM latest_gold_prices"),
  ]);

  return (
    <GoldClient
      purchases={purRes.rows as GoldPurchase[]}
      prices={priceRes.rows as GoldPrice[]}
    />
  );
}
