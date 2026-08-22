import { getPool } from "@/lib/db";
import type { BondHolding, BondCouponPayment, BondCouponSchedule } from "@/lib/types";
import BondsClient from "@/components/BondsClient";

export default async function BondsPage() {
  const pool = getPool();
  const [holdRes, payRes, schedRes] = await Promise.all([
    pool.query("SELECT * FROM bond_holdings WHERE active = true ORDER BY maturity_date ASC"),
    pool.query("SELECT * FROM bond_coupon_payments ORDER BY paid_at DESC"),
    pool.query("SELECT * FROM bond_coupon_schedule ORDER BY distribution_date ASC"),
  ]);

  return (
    <BondsClient
      holdings={holdRes.rows as BondHolding[]}
      payments={payRes.rows as BondCouponPayment[]}
      schedules={schedRes.rows as BondCouponSchedule[]}
    />
  );
}
