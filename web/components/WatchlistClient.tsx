"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { upsertWatchlistItem, deleteWatchlistItem } from "@/app/actions";
import { fmtIdr, fmtAgo, dirGlyph, newestFetchedAt, normalizeTicker, displayTicker } from "@/lib/format";
import type { WatchRow, Snapshot, Analysis } from "@/lib/types";
import RecommendationBadge from "@/components/RecommendationBadge";
import EmptyState from "@/components/EmptyState";
import Modal from "@/components/Modal";
import { MiniSparkline } from "@/components/Sparkline";

const TICKER_RE = /^[A-Z0-9]{1,10}$/;

export default function WatchlistClient({
  watch,
  snaps,
  recs,
  portfolioTickers,
  history,
}: {
  watch: WatchRow[];
  snaps: Snapshot[];
  recs: Pick<Analysis, "ticker" | "recommendation">[];
  portfolioTickers: string[];
  history: Record<string, number[]>;
}) {
  const router = useRouter();
  const snapBy = new Map(snaps.map((s) => [s.ticker.toUpperCase(), s]));
  const recBy = new Map(recs.map((r) => [r.ticker.toUpperCase(), r.recommendation]));
  const portfolio = new Set(portfolioTickers.map((t) => t.toUpperCase()));

  const users = watch.filter((w) => w.kind === "user");
  const ai = watch.filter((w) => w.kind === "ai_suggested");
  const fresh = newestFetchedAt(snaps);

  const [creating, setCreating] = useState(false);
  const [ticker, setTicker] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openAdd() {
    setTicker("");
    setNotes("");
    setErr(null);
    setCreating(true);
  }

  async function add() {
    // validate the plain code, store the yahoo symbol (.JK)
    const plain = displayTicker(ticker);
    setErr(null);
    if (!TICKER_RE.test(plain)) return setErr(`Invalid ticker: ${plain}`);
    const t = normalizeTicker(plain);
    if (portfolio.has(t)) return setErr(`${plain} is already in portfolio.`);
    if (watch.some((w) => normalizeTicker(w.ticker) === t)) return setErr(`${plain} is already in watchlist.`);
    setAdding(true);
    try { await upsertWatchlistItem(t, notes); } catch (e) { setErr(String(e)); setAdding(false); return; }
    setTicker("");
    setNotes("");
    setAdding(false);
    setCreating(false);
    router.refresh();
  }

  async function remove(t: string) {
    try { await deleteWatchlistItem(t); } catch (e) { setErr(String(e)); return; }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-tprimary">Watchlist</h1>
          {fresh && <p className="mt-0.5 text-[11px] text-tdim">synced {fmtAgo(fresh)} · yfinance</p>}
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page"
        >
          <Plus size={14} strokeWidth={2} />
          Add Ticker
        </button>
      </div>

      {creating && (
        <Modal title="Add to Watchlist" onClose={() => setCreating(false)}>
          <div className="grid gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tdim">Ticker</span>
              <input
                placeholder="e.g. BBCA"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tdim">Notes <span className="text-tdim opacity-60">optional</span></span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
              />
            </label>
          </div>
          {err && <p className="mt-3 text-sm text-critical">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={add}
              disabled={adding}
              className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => setCreating(false)}
              disabled={adding}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {err && !creating && <p className="text-sm text-critical">{err}</p>}

      {users.length === 0 ? (
        <EmptyState message="Watchlist is empty." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {users.map((w) => {
              const t = w.ticker.toUpperCase();
              const s = snapBy.get(t);
              const day = s?.day_change_pct ?? null;
              return (
                <div key={t} className="rounded-lg border border-edge bg-component p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/stocks?ticker=${displayTicker(t)}`} className="font-medium text-accent hover:underline">{displayTicker(t)}</Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <RecommendationBadge rec={recBy.get(t)} />
                      <button onClick={() => remove(t)} aria-label={`Remove ${t}`} className="text-tdim hover:text-critical">
                        <X size={15} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-tdim">Price </span>
                      <span className="num text-tprimary">{s?.current_price ? fmtIdr(s.current_price) : "N/A"}</span>
                    </div>
                    <div className={day == null ? "text-tdim" : day >= 0 ? "text-up" : "text-down"}>
                      <span className="text-tdim">Day </span>
                      <span className="num">{day == null ? "N/A" : `${dirGlyph(day)} ${day >= 0 ? "+" : ""}${day.toFixed(2)}%`}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4">TICKER</th>
                  <th className="pb-2 pr-4">PRICE</th>
                  <th className="pb-2 pr-4">DAY %</th>
                  <th className="pb-2 pr-4">TREND</th>
                  <th className="pb-2 pr-4">VERDICT</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((w) => {
                  const t = w.ticker.toUpperCase();
                  const s = snapBy.get(t);
                  const day = s?.day_change_pct ?? null;
                  return (
                    <tr key={t} className="border-t border-edge">
                      <td className="py-2 pr-4">
                        <Link href={`/stocks?ticker=${displayTicker(t)}`} className="font-medium text-accent hover:underline">{displayTicker(t)}</Link>
                      </td>
                      <td className="num py-2 pr-4">{s?.current_price ? fmtIdr(s.current_price) : "N/A"}</td>
                      <td className={`num py-2 pr-4 ${day == null ? "text-tdim" : day >= 0 ? "text-up" : "text-down"}`}>
                        {day == null ? "N/A" : `${dirGlyph(day)} ${day >= 0 ? "+" : ""}${day.toFixed(2)}%`}
                      </td>
                      <td className="py-2 pr-4"><MiniSparkline prices={history[t]} /></td>
                      <td className="py-2 pr-4"><RecommendationBadge rec={recBy.get(t)} /></td>
                      <td className="py-2 text-right">
                        <button onClick={() => remove(t)} aria-label={`Remove ${t}`} className="text-tdim hover:text-critical">
                          <X size={15} strokeWidth={1.5} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ai.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-ai">AI Suggested</h2>
          <ul className="space-y-2">
            {ai.map((w) => (
              <li key={w.ticker} className="rounded-md border border-edge border-l-2 border-l-ai bg-component p-3">
                <div className="font-medium text-tprimary">
                  {displayTicker(w.ticker)}
                  {w.sector && <span className="ml-2 text-xs text-tdim">{w.sector}</span>}
                </div>
                {w.rationale && <div className="mt-0.5 text-sm text-tmuted">{w.rationale}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
