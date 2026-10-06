import { getPool } from "@/lib/db";
import type { Position, Snapshot, Analysis, WatchRow, StockDividend, AccountCharge } from "@/lib/types";
import PortfolioClient from "@/components/PortfolioClient";
import WatchlistClient from "@/components/WatchlistClient";
import AccountChargesClient from "@/components/AccountChargesClient";
import TickerDetail from "@/components/TickerDetail";
import { priceHistory } from "@/lib/history";
import type { PeerRow, Valuation } from "@/lib/peers";

export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string; tab?: string; buy?: string }>;
}) {
  const { ticker, tab, buy } = await searchParams;
  if (ticker) return <TickerDetail ticker={ticker} backHref="/stocks" tab={tab} />;

  const pool = getPool();
  const [posRes, snapRes, anaRes, watchRes, divRes, chgRes, peerRes, valRes] = await Promise.all([
    pool.query("SELECT * FROM portfolio_positions WHERE active = true ORDER BY ticker"),
    pool.query("SELECT * FROM latest_snapshots"),
    pool.query("SELECT ticker, recommendation FROM latest_analyses"),
    pool.query("SELECT * FROM watchlist ORDER BY added_at"),
    pool.query("SELECT * FROM stock_dividends ORDER BY paid_at DESC"),
    pool.query("SELECT * FROM account_charges ORDER BY charged_at DESC"),
    // Peer groups of active holdings, with each peer's name + key stats (price/day % come from snapshots).
    pool.query(
      `SELECT p.ticker, p.peer, p.rank, p.basis, p.group_name, c.name,
              k.market_cap, k.trailing_pe, k.price_to_book, k.total_revenue, k.ebitda, k.total_debt, k.total_cash,
              k.return_on_equity, k.earnings_growth, k.revenue_growth, k.ebitda_margins
         FROM stock_peers p
         LEFT JOIN stock_classification c ON c.ticker = p.peer
         LEFT JOIN stock_key_stats k ON k.ticker = p.peer
        WHERE p.ticker IN (SELECT ticker FROM portfolio_positions WHERE active = true)
        ORDER BY p.ticker, p.rank`,
    ),
    pool.query(
      `SELECT ticker, computed_at, result FROM stock_valuation
        WHERE ticker IN (SELECT ticker FROM portfolio_positions WHERE active = true)`,
    ),
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
        initialBuy={buy}
        peers={peerRes.rows as PeerRow[]}
        valuations={valRes.rows as Valuation[]}
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
