"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X, ChevronDown } from "lucide-react";
import { upsertWatchlistItem, deleteWatchlistItem, promotePeer } from "@/app/actions";
import { fmtIdr, fmtAgo, fmtPctAbs, newestFetchedAt, normalizeTicker, displayTicker } from "@/lib/format";
import type { WatchRow, Snapshot, Analysis } from "@/lib/types";
import RecommendationBadge from "@/components/RecommendationBadge";
import EmptyState from "@/components/EmptyState";
import Modal, { ConfirmDialog } from "@/components/Modal";
import Delta from "@/components/Delta";
import { Field, Form, FormActions, IconButton, PrimaryButton, SecondaryButton, inputCls, errText, useAsyncAction } from "@/components/Form";
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
  const peers = watch.filter((w) => w.kind === "peer");
  const fresh = newestFetchedAt(snaps);

  const [creating, setCreating] = useState(false);
  const [ticker, setTicker] = useState("");
  const [notes, setNotes] = useState("");
  const { busy, error, run } = useAsyncAction();
  const [removing, setRemoving] = useState<string | null>(null);
  const [peersOpen, setPeersOpen] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);

  function openAdd() {
    setTicker("");
    setNotes("");
    setCreating(true);
  }

  async function add() {
    // validate the plain code, store the yahoo symbol (.JK)
    const plain = displayTicker(ticker);
    if (!TICKER_RE.test(plain)) throw new Error(`Invalid ticker: ${plain || "(empty)"}`);
    const t = normalizeTicker(plain);
    if (portfolio.has(t)) throw new Error(`${plain} is already in portfolio.`);
    const existing = watch.find((w) => normalizeTicker(w.ticker) === t);
    if (existing?.kind === "peer") throw new Error(`${plain} is already a peer on the watchlist — use Promote.`);
    if (existing) throw new Error(`${plain} is already in watchlist.`);
    await upsertWatchlistItem(t, notes);
    setCreating(false);
    router.refresh();
  }

  async function promote(t: string) {
    setPromoting(t);
    setPeerError(null);
    try {
      await promotePeer(t);
      router.refresh();
    } catch (e) {
      setPeerError(errText(e));
    } finally {
      setPromoting(null);
    }
  }

  async function remove(t: string) {
    await deleteWatchlistItem(t);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-tprimary">Watchlist</h2>
          {fresh && <p className="mt-0.5 text-caption text-tdim">synced {fmtAgo(fresh)} · yfinance</p>}
        </div>
        <PrimaryButton type="button" onClick={openAdd}>
          <Plus size={14} strokeWidth={2} />
          Add Ticker
        </PrimaryButton>
      </div>

      {creating && (
        <Modal title="Add to Watchlist" onClose={() => setCreating(false)}>
          <Form onSubmit={() => run("save", add)}>
            <div className="grid gap-3">
              <Field label="Ticker">
                <input placeholder="e.g. BBCA" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className={inputCls} />
              </Field>
              <Field label="Notes" optional>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <FormActions busy={busy !== null} error={error} submitLabel="Add" busyLabel="Adding…" onCancel={() => setCreating(false)} />
          </Form>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${displayTicker(removing)} from watchlist?`}
          message={
            peers.some((w) => w.ticker.toUpperCase() === removing)
              ? "It stops being tracked and analysed. The weekly peer refresh adds it back unless you promote it or your holdings change."
              : "It stops being tracked and analysed. Price history is kept."
          }
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}

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
                      <IconButton onClick={() => setRemoving(t)} aria-label={`Remove ${displayTicker(t)}`}>
                        <X size={15} strokeWidth={1.5} />
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-tdim">Price </span>
                      <span className="num text-tprimary">{s?.current_price ? fmtIdr(s.current_price) : "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-tdim">Day </span>
                      <Delta value={day} fmt={fmtPctAbs(2)} empty="N/A" />
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
                <tr className="text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4 text-left">TICKER</th>
                  <th className="pb-2 pr-4 text-right">PRICE</th>
                  <th className="pb-2 pr-4 text-right">DAY %</th>
                  <th className="pb-2 pr-4 text-right">TREND</th>
                  <th className="pb-2 pr-4 text-left">VERDICT</th>
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
                      <td className="num py-2 pr-4 text-right">{s?.current_price ? fmtIdr(s.current_price) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right"><Delta value={day} fmt={fmtPctAbs(2)} empty="N/A" /></td>
                      <td className="py-2 pr-4 text-right"><MiniSparkline prices={history[t]} /></td>
                      <td className="py-2 pr-4"><RecommendationBadge rec={recBy.get(t)} /></td>
                      <td className="py-2 text-right">
                        <IconButton onClick={() => setRemoving(t)} aria-label={`Remove ${displayTicker(t)}`}>
                          <X size={15} strokeWidth={1.5} />
                        </IconButton>
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

      {peers.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={peersOpen}
            aria-controls="watchlist-peers"
            onClick={() => setPeersOpen((o) => !o)}
            className="flex items-center gap-1.5 font-semibold text-tprimary hover:text-accent"
          >
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`transition-transform duration-[120ms] ${peersOpen ? "" : "-rotate-90"}`} />
            Peers ({peers.length})
          </button>
          {peersOpen && (
            <div id="watchlist-peers" className="mt-2">
              <p className="mb-2 text-xs text-tdim">Added automatically from your holdings&apos; peer groups. Promote one to keep it as your own entry.</p>
              {peerError && <p role="alert" className="mb-2 text-sm text-critical">{peerError}</p>}
              <ul className="divide-y divide-edge border-y border-edge">
                {peers.map((w) => {
                  const t = w.ticker.toUpperCase();
                  const s = snapBy.get(t);
                  return (
                    <li key={t} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Link href={`/stocks?ticker=${displayTicker(t)}`} className="font-medium text-accent hover:underline">{displayTicker(t)}</Link>
                        <span className="shrink-0 rounded-sm border border-edge px-1.5 py-px text-[0.6875rem] text-tmuted">Peer</span>
                        {w.notes && <span className="min-w-0 truncate text-xs text-tdim" title={w.notes}>{w.notes}</span>}
                      </div>
                      <span className="num text-tprimary">{s?.current_price ? fmtIdr(s.current_price) : "N/A"}</span>
                      <Delta value={s?.day_change_pct ?? null} fmt={fmtPctAbs(2)} empty="N/A" />
                      <div className="flex shrink-0 items-center gap-1">
                        <SecondaryButton size="sm" onClick={() => promote(t)} disabled={promoting !== null}>
                          {promoting === t ? "Promoting…" : "Promote"}
                        </SecondaryButton>
                        <IconButton onClick={() => setRemoving(t)} aria-label={`Remove ${displayTicker(t)}`}>
                          <X size={15} strokeWidth={1.5} />
                        </IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
