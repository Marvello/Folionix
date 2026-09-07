import type { StockFinancialRow } from "@/lib/types";
import { fmtIdr, fmtAgo } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import EmptyState from "./EmptyState";

const STALE_MS = 7 * 24 * 3_600_000;

/** Quarter label from a period_end date: 2026-06-30 becomes Q2 2026. */
function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-");
  return `Q${Math.ceil(Number(m) / 3)} ${y}`;
}

/** Oldest-to-newest series for a column, or null when fewer than two points. */
function series(rows: StockFinancialRow[], key: "revenue" | "net_income"): number[] | null {
  const vals = rows.slice().reverse().map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length >= 2 ? vals : null;
}

/** Inline trend above the table: a row should communicate direction at a glance. */
function TrendRow({ rows }: { rows: StockFinancialRow[] }) {
  const revenue = series(rows, "revenue");
  const netIncome = series(rows, "net_income");
  if (!revenue && !netIncome) return null;
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {revenue && (
        <div>
          <div className="mb-1 text-xs text-tdim">Revenue trend</div>
          <Sparkline prices={revenue} />
        </div>
      )}
      {netIncome && (
        <div>
          <div className="mb-1 text-xs text-tdim">Net income trend</div>
          <Sparkline prices={netIncome} />
        </div>
      )}
    </div>
  );
}

export default function FinancialsTable({ rows }: { rows: StockFinancialRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="No quarterly financials published for this ticker." />;
  }
  const newest = rows[0]!;
  const stale = Date.now() - new Date(newest.fetched_at).getTime() > STALE_MS;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-tprimary">Quarterly Financials</h2>
        <span className={`text-xs ${stale ? "text-critical" : "text-tdim"}`}>
          {stale ? "stale, " : ""}synced {fmtAgo(newest.fetched_at)} · yahoo-finance2
        </span>
      </div>
      <TrendRow rows={rows} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-left text-xs text-tdim">
              <th className="py-2 font-normal">Quarter</th>
              <th className="py-2 text-right font-normal">Revenue</th>
              <th className="py-2 text-right font-normal">Net income</th>
              <th className="py-2 text-right font-normal">Net margin</th>
              <th className="py-2 text-right font-normal">EPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.period_end}-${r.period_type}`} className="border-b border-edge/50">
                <td className="py-2 text-tsecondary">{quarterLabel(r.period_end)}</td>
                <td className="num py-2 text-right text-tprimary">
                  {r.revenue == null ? "N/A" : fmtIdr(r.revenue)}
                </td>
                <td className={`num py-2 text-right ${
                  r.net_income == null ? "text-tprimary"
                    : r.net_income >= 0 ? "text-up" : "text-down"}`}>
                  {r.net_income == null ? "N/A"
                    : `${r.net_income >= 0 ? "▲ " : "▼ "}${fmtIdr(Math.abs(r.net_income))}`}
                </td>
                <td className="num py-2 text-right text-tsecondary">
                  {r.net_margin_pct == null ? "N/A" : `${r.net_margin_pct.toFixed(1)}%`}
                </td>
                <td className="num py-2 text-right text-tsecondary">
                  {r.eps == null ? "N/A" : r.eps.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {newest.currency && newest.currency !== "IDR" && (
        <p className="mt-2 text-xs text-tdim">
          Reported in {newest.currency}, not converted.
        </p>
      )}
    </section>
  );
}
