import type { StockKeyStatsRow } from "@/lib/types";
import { fmtAgo } from "@/lib/format";
import { statGroups } from "@/lib/keystats";
import EmptyState from "./EmptyState";

const STALE_MS = 7 * 24 * 3_600_000;

export default function KeyStats({ row }: { row: StockKeyStatsRow | null }) {
  if (!row) return <EmptyState message="No key statistics fetched for this ticker yet." />;
  const groups = statGroups(row);
  if (groups.length === 0) {
    return <EmptyState message="No key statistics published for this ticker." />;
  }
  const stale = Date.now() - new Date(row.fetched_at).getTime() > STALE_MS;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-tprimary">Key Stats</h2>
        <span className={`text-xs ${stale ? "text-critical" : "text-tdim"}`}>
          {stale ? "stale, " : ""}synced {fmtAgo(row.fetched_at)} · yahoo-finance2
        </span>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 text-xs text-tdim">{g.label}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {g.stats.map((s) => (
                <div key={s.label}>
                  <div className="text-xs text-tdim">{s.label}</div>
                  <div className="num mt-0.5 text-sm font-semibold text-tprimary">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
