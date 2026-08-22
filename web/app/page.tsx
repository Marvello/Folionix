import Link from "next/link";
import { getPool } from "@/lib/db";
import { displayTicker, fmtIdr, fmtIdrCompact, fmtWibDate, fmtAgo, dirGlyph } from "@/lib/format";
import { aggregatePortfolio } from "@folionix/lib";
import type { Position, Snapshot, NewsRow, GoldPurchase, GoldPrice, BondHolding, BondCouponSchedule, BondCouponPayment, FundPurchase, FundNav, StockTransaction, StockDividend, DividendSchedule } from "@/lib/types";
import { buildCalendarEvents } from "@/lib/calendarEvents";
import MetricCard from "@/components/MetricCard";
import ActivityCalendar from "@/components/ActivityCalendar";

export default async function DashboardPage() {
  const pool = getPool();
  const [posRes, snapRes, newsRes, goldPurRes, goldPriceRes, bondRes, bondCalRes, schedRes, bondPayRes, fundPurRes, fundNavRes, fxRes, stockDivRes, fundDistRes, chgRes, txnRes, divSchedRes] = await Promise.all([
    pool.query("SELECT avg_price, lots, ticker, realized_pnl FROM portfolio_positions WHERE active = true"),
    pool.query("SELECT ticker, current_price, fetched_at FROM latest_snapshots"),
    pool.query("SELECT * FROM news_cache ORDER BY published_at DESC LIMIT 8"),
    pool.query("SELECT * FROM gold_purchases WHERE active = true"),
    pool.query("SELECT * FROM latest_gold_prices"),
    pool.query("SELECT principal, purchase_price FROM bond_holdings WHERE active = true"),
    pool.query("SELECT id, series_code, principal, coupon_rate, purchased_at, active FROM bond_holdings WHERE active = true"),
    pool.query("SELECT * FROM bond_coupon_schedule"),
    pool.query("SELECT bond_holding_id, paid_at, amount FROM bond_coupon_payments"),
    pool.query("SELECT fund_code, units, buy_nav_per_unit, currency, side, purchased_at, id FROM fund_purchases WHERE active = true"),
    pool.query("SELECT fund_code, nav FROM latest_fund_navs"),
    pool.query("SELECT base_currency, quote_currency, rate FROM latest_forex_rates WHERE quote_currency = 'IDR'"),
    pool.query("SELECT ticker, amount, per_share, paid_at, notes FROM stock_dividends"),
    pool.query("SELECT amount FROM fund_distributions"),
    pool.query("SELECT amount FROM account_charges"),
    pool.query("SELECT ticker, side, lots, price, txn_at, notes FROM stock_transactions"),
    pool.query("SELECT * FROM dividend_schedule"),
  ]);

  const positions = posRes.rows as Position[];
  const snaps = snapRes.rows as Snapshot[];
  const news = newsRes.rows as NewsRow[];
  const goldPurchases = goldPurRes.rows as GoldPurchase[];
  const goldPrices = goldPriceRes.rows as GoldPrice[];
  const bonds = bondRes.rows as BondHolding[];
  const bondHoldings = bondCalRes.rows as BondHolding[];
  const schedules = schedRes.rows as BondCouponSchedule[];
  const bondPayments = bondPayRes.rows as BondCouponPayment[];
  const fundPurchases = fundPurRes.rows as FundPurchase[];
  const fundNavs = fundNavRes.rows as FundNav[];
  const fxToIdr = new Map(
    (fxRes.rows as { base_currency: string; rate: number }[]).map((r) => [r.base_currency, r.rate])
  );
  const stockDividends = stockDivRes.rows as StockDividend[];
  const fundDistributions = fundDistRes.rows as { amount: number }[];
  const stockTxns = txnRes.rows as StockTransaction[];
  const dividendSchedule = divSchedRes.rows as DividendSchedule[];

  const calendarEvents = buildCalendarEvents({
    bondSchedules: schedules,
    bondHoldings,
    bondPayments,
    stockTxns,
    stockDividends,
    dividendSchedule,
    positions,
    goldPurchases,
    fundPurchases,
    fxToIdr,
  });

  // Data freshness
  const newestFetch = snaps.reduce<string | null>(
    (acc, s) => (s.fetched_at && (!acc || s.fetched_at > acc) ? s.fetched_at : acc),
    null,
  );

  const {
    netWorth, combinedPnl, totalIncome, totalRealized, totalCapital,
    totalCharges, totalReturn, products, totalProductCost,
  } = aggregatePortfolio({
    positions,
    snapshots: snaps,
    goldPurchases,
    goldPrices,
    bonds,
    bondPayments,
    fundPurchases,
    fundNavs,
    fxToIdr,
    stockDividends,
    fundDistributions,
    accountCharges: chgRes.rows as { amount: number }[],
  });

  // Color per product — hex avoids Tailwind purge issues with dynamic class names
  const PRODUCT_COLOR: Record<string, string> = {
    Stocks: "#22d3ee",   // cyan
    Gold: "#fbbf24",     // amber
    Bonds: "#a78bfa",    // violet
    Funds: "#34d399",    // emerald
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 sm:gap-4">
        <MetricCard
          label="Net Worth"
          value={fmtIdrCompact(netWorth)}
          fullValue={fmtIdr(netWorth)}
          sub={newestFetch ? `synced ${fmtAgo(newestFetch)} · yfinance` : undefined}
        />
        <MetricCard
          label="Capital"
          value={`${totalCapital >= 0 ? "+" : ""}${fmtIdrCompact(totalCapital)}`}
          fullValue={`${totalCapital >= 0 ? "+" : ""}${fmtIdr(totalCapital)}`}
          color={totalCapital >= 0 ? "up" : "down"}
          glyph={dirGlyph(totalCapital)}
          sub={`Unreal. ${combinedPnl >= 0 ? "+" : ""}${fmtIdrCompact(combinedPnl)} · Real. ${totalRealized >= 0 ? "+" : ""}${fmtIdrCompact(totalRealized)}`}
        />
        <MetricCard
          label="Income"
          value={fmtIdrCompact(totalIncome)}
          fullValue={fmtIdr(totalIncome)}
          color={totalIncome > 0 ? "up" : undefined}
          glyph={dirGlyph(totalIncome)}
          sub="Dividends + distributions + coupons"
        />
        <MetricCard
          label="Fees"
          value={totalCharges > 0 ? `-${fmtIdrCompact(totalCharges)}` : fmtIdrCompact(0)}
          fullValue={totalCharges > 0 ? `-${fmtIdr(totalCharges)}` : fmtIdr(0)}
          color={totalCharges > 0 ? "down" : undefined}
          glyph={dirGlyph(-totalCharges)}
          sub="Data + stamp + late fees"
        />
        <MetricCard
          label="Total Return"
          value={`${totalReturn >= 0 ? "+" : ""}${fmtIdrCompact(totalReturn)}`}
          fullValue={`${totalReturn >= 0 ? "+" : ""}${fmtIdr(totalReturn)}`}
          color={totalReturn >= 0 ? "up" : "down"}
          glyph={dirGlyph(totalReturn)}
          sub="Capital + Income − Fees"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section>
            <h2 className="mb-2 font-semibold text-tprimary">By Product</h2>
            {netWorth > 0 && (
              <div className="mb-3">
                <div className="flex h-2 overflow-hidden rounded-full bg-edge">
                  {products.map(
                    (pr) =>
                      pr.value > 0 && (
                        <div
                          key={pr.name}
                          style={{ width: `${(pr.value / netWorth) * 100}%`, backgroundColor: PRODUCT_COLOR[pr.name] }}
                        />
                      ),
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-tdim">
                  {products.map(
                    (pr) =>
                      pr.value > 0 && (
                        <span key={pr.name} className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ backgroundColor: PRODUCT_COLOR[pr.name] }}
                          />
                          {pr.name}{" "}
                          <span className="num text-tmuted">
                            {((pr.value / netWorth) * 100).toFixed(0)}%
                          </span>
                        </span>
                      ),
                  )}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4 text-left">PRODUCT</th>
                  <th className="pb-2 pr-6 text-right">CURRENT VALUE</th>
                  <th className="pb-2 pr-6 text-right">INCOME</th>
                  <th className="pb-2 text-right">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {products.map((pr) => {
                  const pct = pr.cost ? (pr.pnl / pr.cost) * 100 : null;
                  const hasValue = pr.value > 0;
                  return (
                    <tr key={pr.name} className="border-t border-edge">
                      <td className="py-2 pr-4 font-medium text-tprimary">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: PRODUCT_COLOR[pr.name] }} />
                          {pr.name}
                        </span>
                      </td>
                      <td className="num py-2 pr-6 text-right">{hasValue ? fmtIdr(pr.value) : "N/A"}</td>
                      <td className="num py-2 pr-6 text-right">
                        <span className={pr.income > 0 ? "text-up" : "text-tdim"}>
                          {pr.income > 0 ? `+${fmtIdr(pr.income)}` : "—"}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap py-2 text-right">
                        <span className={!hasValue ? "text-tdim" : pr.pnl >= 0 ? "text-up" : "text-down"}>
                          {!hasValue ? "N/A" : `${dirGlyph(pr.pnl)} ${pr.pnl >= 0 ? "+" : ""}${fmtIdr(pr.pnl)}`}
                        </span>{" "}
                        {pct != null && hasValue && (
                          <span className={pct >= 0 ? "text-up" : "text-down"}>
                            {`(${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-edge font-semibold">
                  <td className="py-2 pr-4">Total</td>
                  <td className="num py-2 pr-6 text-right">{netWorth > 0 ? fmtIdr(netWorth) : "N/A"}</td>
                  <td className="num py-2 pr-6 text-right">
                    <span className={totalIncome > 0 ? "text-up" : "text-tdim"}>
                      {totalIncome > 0 ? `+${fmtIdr(totalIncome)}` : "—"}
                    </span>
                  </td>
                  <td className="num whitespace-nowrap py-2 text-right">
                    <span className={netWorth <= 0 ? "text-tdim" : combinedPnl >= 0 ? "text-up" : "text-down"}>
                      {netWorth <= 0 ? "N/A" : `${dirGlyph(combinedPnl)} ${combinedPnl >= 0 ? "+" : ""}${fmtIdr(combinedPnl)}`}
                    </span>{" "}
                    {totalProductCost > 0 && netWorth > 0 && (
                      <span className={combinedPnl >= 0 ? "text-up" : "text-down"}>
                        {`(${combinedPnl >= 0 ? "+" : ""}${((combinedPnl / totalProductCost) * 100).toFixed(1)}%)`}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </section>
        </div>

        <section className="space-y-6">
          {calendarEvents.length > 0 && (
            <ActivityCalendar events={calendarEvents} />
          )}
          <div>
          <h2 className="mb-2 font-semibold text-tprimary">Latest News</h2>
          {news.length === 0 ? (
            <p className="text-sm text-tdim">No news available.</p>
          ) : (
            <ul className="space-y-3">
              {news.map((n) => (
                <li key={n.id}>
                  <Link href={`/news?id=${n.id}`} className="text-sm text-tsecondary hover:text-tprimary">
                    {n.headline}
                  </Link>
                  <div className="mt-0.5 text-xs text-tdim">
                    <span className={n.ticker ? "text-accent" : "text-warn"}>
                      {n.ticker ? displayTicker(n.ticker) : "MACRO"}
                    </span>{" "}
                    · {n.source} · {fmtWibDate(n.published_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}
