import { getPool } from "@/lib/db";
import type { Position, Snapshot, Analysis, WatchRow, StockDividend, AccountCharge } from "@/lib/types";
import PortfolioClient from "@/components/PortfolioClient";
import WatchlistClient from "@/components/WatchlistClient";
import AccountChargesClient from "@/components/AccountChargesClient";
import TickerDetail from "@/components/TickerDetail";
import { priceHistory } from "@/lib/history";

export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  if (ticker) return <TickerDetail ticker={ticker} backHref="/stocks" />;

  const pool = getPool();
  const [posRes, snapRes, anaRes, watchRes, divRes, chgRes] = await Promise.all([
    pool.query("SELECT * FROM portfolio_positions WHERE active = true ORDER BY ticker"),
    pool.query("SELECT * FROM latest_snapshots"),
    pool.query("SELECT ticker, recommendation FROM latest_analyses"),
    pool.query("SELECT * FROM watchlist ORDER BY added_at"),
    pool.query("SELECT * FROM stock_dividends ORDER BY paid_at DESC"),
    pool.query("SELECT * FROM account_charges ORDER BY charged_at DESC"),
  ]);

  const positions = posRes.rows as Position[];
  const watch = watchRes.rows as WatchRow[];
  const allTickers = Array.from(new Set([...positions.map((p) => p.ticker), ...watch.map((w) => w.ticker)]));
  const history = await priceHistory(pool, allTickers);

  return (
    <div className="space-y-8">
      <PortfolioClient
        positions={positions}
        snaps={snapRes.rows as Snapshot[]}
        recs={anaRes.rows as Pick<Analysis, "ticker" | "recommendation">[]}
        history={history}
        dividends={divRes.rows as StockDividend[]}
      />
      <WatchlistClient
        watch={watch}
        snaps={snapRes.rows as Snapshot[]}
        recs={anaRes.rows as Pick<Analysis, "ticker" | "recommendation">[]}
        portfolioTickers={positions.map((p) => p.ticker)}
        history={history}
      />
      <AccountChargesClient charges={chgRes.rows as AccountCharge[]} />
    </div>
  );
}
