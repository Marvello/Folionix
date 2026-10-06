import Link from "next/link";
import Delta from "@/components/Delta";
import { displayTicker, fmtAgo, fmtIdr, fmtPctAbs, isStale } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import {
  basisLabel, fmtMultiple, fmtQuality, peerMultiple, peerMultipleLabel, peerQuality,
  type PeerRow, type Valuation,
} from "@/lib/peers";

// Valuations are recomputed daily after the 18:00 fundamentals sweep.
const STALE_MS = 3 * 24 * 3_600_000;

/** Expanded "Peers" content for one holding: 3-way verdict + compact peer table. No hooks, so any parent can render it. */
export default function PeerPanel({
  valuation,
  peers,
  snapBy,
}: {
  valuation: Valuation | undefined;
  peers: PeerRow[];
  snapBy: Map<string, Snapshot>;
}) {
  if (!valuation || peers.length === 0) {
    return <p className="text-sm text-tdim">Peer valuation not computed yet.</p>;
  }
  const r = valuation.result;
  const stale = isStale(valuation.computed_at, STALE_MS);
  const g = peers[0];
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-xs text-tmuted">
          {g.group_name} <span className="text-tdim">· by {basisLabel(g.basis)}</span>
        </span>
        <span className={`text-xs ${stale ? "text-critical" : "text-tdim"}`}>
          {stale ? "stale, " : ""}computed {fmtAgo(valuation.computed_at)}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-tdim">{r.multiple_name} vs peer median</dt>
          <dd>
            <span className="num text-tprimary">{fmtMultiple(r.value)}</span>
            <span className="text-tdim"> vs </span>
            <span className="num text-tmuted">{fmtMultiple(r.peers.median)}</span>{" "}
            <Delta value={r.peers.diff != null ? r.peers.diff * 100 : null} fmt={fmtPctAbs(0)} paren neutral />{" "}
            <span className="text-tmuted">{r.peers.verdict}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-tdim">{r.quality.name} vs peer median</dt>
          <dd>
            <span className="num text-tprimary">{fmtQuality(r.lens, r.quality.value)}</span>
            <span className="text-tdim"> vs </span>
            <span className="num text-tmuted">{fmtQuality(r.lens, r.quality.peer_median)}</span>{" "}
            <span className="text-tmuted">{r.quality.verdict}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-tdim">vs own {r.own.years ? `${r.own.years}-year ` : ""}average</dt>
          <dd>
            <span className="num text-tmuted">{fmtMultiple(r.own.avg)}</span>{" "}
            <Delta value={r.own.diff != null ? r.own.diff * 100 : null} fmt={fmtPctAbs(0)} paren neutral />{" "}
            <span className="text-tmuted">{r.own.verdict}</span>
          </dd>
        </div>
      </dl>
      <p className="text-sm font-medium text-tprimary">{r.read}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-xs">
          <thead>
            <tr className="text-tdim">
              <th className="pb-1 pr-3 text-right font-semibold">#</th>
              <th className="pb-1 pr-3 text-left font-semibold">PEER</th>
              <th className="pb-1 pr-3 text-left font-semibold">NAME</th>
              <th className="pb-1 pr-3 text-right font-semibold">PRICE</th>
              <th className="pb-1 pr-3 text-right font-semibold">DAY %</th>
              <th className="pb-1 pr-3 text-right font-semibold">{peerMultipleLabel(r).toUpperCase()}</th>
              <th className="pb-1 text-right font-semibold">{r.quality.name.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => {
              const s = snapBy.get(p.peer.toUpperCase());
              return (
                <tr key={p.peer} className="border-t border-edge/50">
                  <td className="num py-1 pr-3 text-right text-tdim">{p.rank}</td>
                  <td className="py-1 pr-3">
                    <Link href={`/stocks?ticker=${displayTicker(p.peer)}`} className="font-medium text-accent hover:underline">
                      {displayTicker(p.peer)}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate py-1 pr-3 text-tmuted" title={p.name ?? undefined}>{p.name ?? "—"}</td>
                  <td className="num py-1 pr-3 text-right">{s?.current_price ? fmtIdr(s.current_price) : "—"}</td>
                  <td className="num py-1 pr-3 text-right"><Delta value={s?.day_change_pct} fmt={fmtPctAbs(2)} /></td>
                  <td className="num py-1 pr-3 text-right">{fmtMultiple(peerMultiple(r.lens, p))}</td>
                  <td className="num py-1 text-right">{fmtQuality(r.lens, peerQuality(r.lens, p, s?.div_yield_pct))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
