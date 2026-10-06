"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { upsertWatchlistItem, deleteWatchlistItem } from "@/app/actions";
import { fmtIdr, fmtAgo, fmtPctAbs, newestFetchedAt, normalizeTicker, displayTicker } from "@/lib/format";
import type { WatchRow, Snapshot, Analysis } from "@/lib/types";
import RecommendationBadge from "@/components/RecommendationBadge";
import EmptyState from "@/components/EmptyState";
import Modal, { ConfirmDialog } from "@/components/Modal";
import Delta from "@/components/Delta";
import { Field, Form, FormActions, IconButton, PrimaryButton, inputCls, useAsyncAction } from "@/components/Form";
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
  const { busy, error, run } = useAsyncAction();
  const [removing, setRemoving] = useState<string | null>(null);

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
    if (watch.some((w) => normalizeTicker(w.ticker) === t)) throw new Error(`${plain} is already in watchlist.`);
    await upsertWatchlistItem(t, notes);
    setCreating(false);
    router.refresh();
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
          message="It stops being tracked and analysed. Price history is kept."
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
    </div>
  );
}
