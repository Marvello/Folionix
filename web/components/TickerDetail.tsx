import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPool } from "@/lib/db";
import { fmtIdr, fmtWib, fmtWibDate, fmtAgo, dirGlyph, newsCutoffIso, normalizeTicker, displayTicker } from "@/lib/format";
import type {
  Position, Snapshot, Analysis, NewsRow, AccuracyRow, StockTransaction, StockDividend,
} from "@/lib/types";
import PriceChart from "@/components/PriceChart";
import AnalysisNewsPanels from "@/components/AnalysisNewsPanels";
import type { ChartPoint } from "@/lib/chart";
import { positionMetrics } from "@/lib/position";
import { mergeTxnLedger, type LedgerEntry } from "@/lib/ledger-view";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-edge bg-component p-3">
      <div className="text-xs text-tdim">{label}</div>
      <div className="num mt-0.5 text-sm font-semibold text-tprimary">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | null }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tprimary";
  return (
    <div>
      <div className="text-xs text-tdim">{label}</div>
      <div className={`num mt-0.5 text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function num(v: number | null | undefined, suffix = ""): string {
  return v == null ? "N/A" : `${v}${suffix}`;
}

const LEDGER_LABEL: Record<LedgerEntry["type"], string> = { BUY: "Buy", SELL: "Sell", DIVIDEND: "Dividend" };

export default async function TickerDetail({
  ticker,
  backHref = "/stocks",
}: {
  ticker: string;
  backHref?: string;
}) {
  const t = normalizeTicker(ticker);
  const pool = getPool();

  const [snapRes, posRes, txnRes, divRes, anaRes, newsRes, accRes] = await Promise.all([
    pool.query("SELECT * FROM stock_snapshots WHERE ticker = $1 ORDER BY fetched_at DESC LIMIT 1000", [t]),
    pool.query("SELECT * FROM portfolio_positions WHERE ticker = $1 AND active = true LIMIT 1", [t]),
    pool.query("SELECT * FROM stock_transactions WHERE ticker = $1 ORDER BY txn_at DESC", [t]),
    pool.query("SELECT * FROM stock_dividends WHERE ticker = $1 ORDER BY paid_at DESC", [t]),
    pool.query("SELECT * FROM llm_analyses WHERE ticker = $1 ORDER BY analysed_at DESC LIMIT 20", [t]),
    pool.query("SELECT * FROM news_with_latest_sentiment WHERE ticker = $1 AND published_at >= $2 ORDER BY published_at DESC LIMIT 30", [t, newsCutoffIso()]),
    pool.query("SELECT * FROM recommendation_accuracy($1)", [3]),
  ]);

  const snaps = snapRes.rows as Snapshot[];
  const position = (posRes.rows[0] ?? null) as Position | null;
  const txns = txnRes.rows as StockTransaction[];
  const dividends = divRes.rows as StockDividend[];
  const analyses = anaRes.rows as Analysis[];
  const news = newsRes.rows as NewsRow[];
  const accuracy = (accRes.rows as AccuracyRow[]).filter((r) => normalizeTicker(r.ticker) === t);

  const latest = snaps[0];
  const held = position != null && (position.lots ?? 0) > 0;
  const metrics = held ? positionMetrics(position!, latest?.current_price ?? null, dividends) : null;
  const ledger = mergeTxnLedger(txns, dividends);

  const points: ChartPoint[] = snaps
    .filter((s): s is Snapshot & { current_price: number; fetched_at: string } => s.current_price != null && s.fetched_at != null)
    .map((s) => ({ t: s.fetched_at, price: s.current_price }))
    .reverse();

  return (
    <div className="space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
        <ArrowLeft size={14} strokeWidth={1.5} /> Back
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium text-tprimary">{displayTicker(t)}</h1>
          {!held && (
            <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-tmuted">Watching · not held</span>
          )}
          {!held && (
            <Link href="/stocks" className="rounded-md border border-edge px-2.5 py-1 text-xs text-accent hover:text-tprimary">Buy</Link>
          )}
        </div>
        {latest && (
          <div className="mt-1 text-tsecondary">
            {latest.name ? `${latest.name} · ` : ""}
            <span className="num">{fmtIdr(latest.current_price)}</span>{" "}
            {latest.day_change_pct != null && (
              <span className={`num ${latest.day_change_pct >= 0 ? "text-up" : "text-down"}`}>
                {dirGlyph(latest.day_change_pct)} {latest.day_change_pct >= 0 ? "+" : ""}
                {latest.day_change_pct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
        {latest?.fetched_at && (
          <p className="mt-0.5 text-[11px] text-tdim">
            Price updated {fmtWib(latest.fetched_at)} ({fmtAgo(latest.fetched_at)}) · yfinance
          </p>
        )}
      </div>

      {metrics && (
        <section>
          <h2 className="mb-2 font-semibold text-tprimary">Your Position</h2>
          <div className="rounded-lg border border-edge bg-component p-4">
            <div className="mb-4 border-b border-edge pb-4">
              <div className="text-xs text-tdim">Unrealized P&amp;L</div>
              <div className={`num text-2xl font-semibold ${metrics.unrealizedPnl >= 0 ? "text-up" : "text-down"}`}>
                {fmtIdr(metrics.unrealizedPnl)}
                {metrics.unrealizedPct != null && (
                  <span className="ml-2 text-base">
                    {dirGlyph(metrics.unrealizedPct)} {metrics.unrealizedPct >= 0 ? "+" : ""}{metrics.unrealizedPct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              <Metric label="Lots" value={metrics.lots.toLocaleString("id-ID")} />
              <Metric label="Avg Cost" value={fmtIdr(metrics.avgPrice, 2)} />
              <Metric label="Cost Basis" value={fmtIdr(metrics.costBasis)} />
              <Metric label="Market Value" value={metrics.marketValue ? fmtIdr(metrics.marketValue) : "N/A"} />
              <Metric label="Realized P&amp;L" value={fmtIdr(metrics.realized)} tone={metrics.realized >= 0 ? "up" : "down"} />
              <Metric label="Dividend Income" value={fmtIdr(metrics.income)} />
              <Metric label="Total Return" value={fmtIdr(metrics.totalReturn)} tone={metrics.totalReturn >= 0 ? "up" : "down"} />
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold text-tprimary">Price History</h2>
        <PriceChart points={points} avgCost={metrics?.avgPrice ?? null} />
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-tprimary">Transactions</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-tdim">No transactions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4 text-left">DATE</th>
                  <th className="pb-2 pr-4 text-left">TYPE</th>
                  <th className="pb-2 pr-4 text-right">LOTS</th>
                  <th className="pb-2 pr-4 text-right">PRICE</th>
                  <th className="pb-2 pr-4 text-right">FEE</th>
                  <th className="pb-2 text-right">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.key} className="border-t border-edge">
                    <td className="py-2 pr-4 text-tmuted">{fmtWibDate(r.date)}</td>
                    <td className={`py-2 pr-4 ${r.type === "SELL" ? "text-down" : r.type === "DIVIDEND" ? "text-up" : "text-tprimary"}`}>{LEDGER_LABEL[r.type]}</td>
                    <td className="num py-2 pr-4 text-right">{r.lots == null ? "-" : r.lots.toLocaleString("id-ID")}</td>
                    <td className="num py-2 pr-4 text-right">{r.price == null ? "-" : fmtIdr(r.price)}</td>
                    <td className="num py-2 pr-4 text-right text-tmuted">{r.fee == null ? "-" : fmtIdr(r.fee)}</td>
                    <td className="num py-2 text-right">{fmtIdr(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {latest && (
        <section>
          <h2 className="mb-2 font-semibold text-tprimary">Fundamentals</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <Stat label="P/E" value={num(latest.pe)} />
            <Stat label="P/B" value={num(latest.pb)} />
            <Stat label="ROE %" value={num(latest.roe_pct)} />
            <Stat label="Div Yield %" value={num(latest.div_yield_pct)} />
            <Stat label="Profit Margin %" value={num(latest.profit_margin_pct)} />
            <Stat label="Debt/Equity" value={num(latest.debt_to_equity)} />
            <Stat label="Beta" value={num(latest.beta)} />
            <Stat label="EPS" value={num(latest.eps)} />
            <Stat label="52w High" value={fmtIdr(latest.high_52w)} />
            <Stat label="52w Low" value={fmtIdr(latest.low_52w)} />
            <Stat label="Volume" value={latest.volume == null ? "N/A" : latest.volume.toLocaleString("id-ID")} />
            <Stat label="Market Cap" value={fmtIdr(latest.market_cap_raw)} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold text-tprimary">Recommendation Accuracy (3d)</h2>
        {accuracy.length === 0 ? (
          <p className="text-sm text-tdim">Not enough history.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-tdim">
                  <th className="pb-1">WHEN</th>
                  <th className="pb-1">REC</th>
                  <th className="pb-1">CHANGE</th>
                  <th className="pb-1">CORRECT</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.map((r, i) => (
                  <tr key={i} className="border-t border-edge">
                    <td className="py-1">{fmtWibDate(r.analysed_at)}</td>
                    <td className="py-1">{r.recommendation}</td>
                    <td className={`num py-1 ${(r.actual_change_pct ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                      {r.actual_change_pct == null ? "-" : `${dirGlyph(r.actual_change_pct)} ${r.actual_change_pct}%`}
                    </td>
                    <td className="py-1">
                      {r.correct == null ? (
                        "-"
                      ) : r.correct ? (
                        <span className="text-up">Correct</span>
                      ) : (
                        <span className="text-down">Miss</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AnalysisNewsPanels analyses={analyses} news={news} />
    </div>
  );
}
