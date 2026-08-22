import { getPool } from "@/lib/db";
import type { FundPurchase, FundNav, FundCatalogItem, ForexRate, FundDistribution, FundHolding } from "@/lib/types";
import FundsClient from "@/components/FundsClient";

export default async function FundsPage() {
  const pool = getPool();
  const [purRes, navRes, catRes, fxRes, distRes, holdRes] = await Promise.all([
    pool.query("SELECT * FROM fund_purchases WHERE active = true ORDER BY purchased_at DESC"),
    pool.query("SELECT * FROM latest_fund_navs"),
    pool.query("SELECT * FROM fund_catalog WHERE active = true ORDER BY name"),
    pool.query("SELECT * FROM latest_forex_rates"),
    pool.query("SELECT * FROM fund_distributions ORDER BY paid_at DESC"),
    pool.query("SELECT * FROM fund_holdings ORDER BY percentage DESC"),
  ]);

  const purchases = purRes.rows as FundPurchase[];
  const platforms = [...new Set(purchases.map((p) => p.platform).filter(Boolean))].sort();

  return (
    <FundsClient
      purchases={purchases}
      navs={navRes.rows as FundNav[]}
      catalog={catRes.rows as FundCatalogItem[]}
      forexRates={fxRes.rows as ForexRate[]}
      knownPlatforms={platforms}
      distributions={distRes.rows as FundDistribution[]}
      holdings={holdRes.rows as FundHolding[]}
    />
  );
}
