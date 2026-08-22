"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, RefreshCw } from "lucide-react";
import {
  insertPriceRefreshRequest,
  pollLatestGoldPriceTime,
  insertGoldPurchase,
  updateGoldPurchase,
  deactivateGoldPurchase,
} from "@/app/actions";
import { fmtIdr, fmtIdrCompact, fmtWib, fmtAgo, dirGlyph } from "@/lib/format";
import type { GoldPurchase, GoldPrice } from "@/lib/types";
import { foldWeightedAvg, type LedgerLot } from "@folionix/lib";
import MetricCard from "@/components/MetricCard";
import EmptyState from "@/components/EmptyState";
import Modal from "@/components/Modal";
import Pager from "@/components/Pager";
import { usePaged } from "@/lib/usePaged";

// known gold venues — add new venues here when adding backend support
const KNOWN_GOLD_VENUES = ["cermati"];

// datetime-local input value (YYYY-MM-DDTHH:mm) in the browser's local time.
const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const nowLocalInput = () => toLocalInput(new Date());

type Editing = {
  id: number;
  grams: string;
  price: string;
  cost: string;
  notes: string;
  purchased: string;
} | null;

export default function GoldClient({
  purchases,
  prices,
}: {
  purchases: GoldPurchase[];
  prices: GoldPrice[];
}) {
  const router = useRouter();
  const sellByVenue = new Map(prices.map((p) => [p.venue, p.sell_price]));
  const fresh = prices.reduce<string | null>(
    (acc, p) => (p.fetched_at && (!acc || p.fetched_at > acc) ? p.fetched_at : acc),
    null,
  );
  const venues = [...new Set([...KNOWN_GOLD_VENUES, ...prices.map((p) => p.venue)])];
  const heldVenues = [...new Set(purchases.map((p) => p.venue))];

  const [editing, setEditing] = useState<Editing>(null);
  const [creating, setCreating] = useState(false);
  const [selling, setSelling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Guard the refetch poll against firing after the component unmounts.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function refetchPrices() {
    setRefreshing(true);
    setErr(null);
    const baseline = fresh;
    await insertPriceRefreshRequest("gold");
    const deadline = Date.now() + 30000;
    const tick = async () => {
      if (!alive.current) return;
      const newest = await pollLatestGoldPriceTime();
      const done = (newest && (!baseline || newest > baseline)) || Date.now() > deadline;
      if (!alive.current) return;
      if (done) {
        router.refresh();
        setRefreshing(false);
        return;
      }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
  }

  // Per-row display math. BUY rows keep the usual cost/value/P&L; a SELL row
  // has no "value" of its own (the gold is gone) so we show sale proceeds in
  // the cost slot instead and blank out value/P&L rather than showing a
  // number that would misleadingly imply the sold grams are still held.
  const rows = purchases.map((p) => {
    const side = p.side ?? "BUY";
    const rowAmount = p.grams * p.buy_price_per_gram; // cost (BUY) or proceeds (SELL)
    const sell = sellByVenue.get(p.venue) ?? null;
    const value = side === "BUY" && sell != null ? p.grams * sell : null;
    const pnl = side === "BUY" && value != null ? value - rowAmount : null;
    const pnlPct = pnl != null && rowAmount ? (pnl / rowAmount) * 100 : null;
    return { p, side, rowAmount, value, pnl, pnlPct };
  });
  const grams4 = (g: number) => g.toLocaleString("id-ID", { maximumFractionDigits: 4 });
  const { page, setPage, totalPages, pageItems } = usePaged(rows);

  // Net totals must be folded chronologically per venue (a SELL realizes P&L
  // against the average buy price at the time, and never changes that
  // average) — summing raw rows would double-count or misprice partial
  // sells. Group by venue, sort each group ascending, then fold.
  const venueGroups = new Map<string, GoldPurchase[]>();
  for (const p of purchases) {
    const arr = venueGroups.get(p.venue);
    if (arr) arr.push(p);
    else venueGroups.set(p.venue, [p]);
  }

  let netGrams = 0;
  let costBasis = 0;
  let realizedPnl = 0;
  let marketValue = 0;
  let hasValue = false;
  const netGramsByVenue = new Map<string, number>();
  for (const [venue, venueRows] of venueGroups) {
    const sorted = [...venueRows].sort((a, b) =>
      a.purchased_at === b.purchased_at ? a.id - b.id : a.purchased_at.localeCompare(b.purchased_at),
    );
    const lots: LedgerLot[] = sorted.map((p) => ({
      side: p.side ?? "BUY",
      qty: p.grams,
      price: p.buy_price_per_gram,
      at: p.purchased_at,
    }));
    const f = foldWeightedAvg(lots);
    netGrams += f.netQty;
    costBasis += f.totalBuyCost;
    realizedPnl += f.realizedPnl;
    netGramsByVenue.set(venue, f.netQty);
    const sell = sellByVenue.get(venue);
    if (sell != null) {
      hasValue = true;
      marketValue += f.netQty * sell;
    }
  }
  const unrealizedPnl = hasValue ? marketValue - costBasis : null;
  const unrealizedPnlPct = unrealizedPnl != null && costBasis ? (unrealizedPnl / costBasis) * 100 : null;

  async function save(
    id: number | null,
    venue: string,
    grams: string,
    price: string,
    notes: string,
    purchased: string,
  ) {
    const purchasedAt = new Date(purchased).toISOString();
    const g = Number(grams) || 0;
    const pricePerGram = Number(price) || 0;
    if (id == null) {
      await insertGoldPurchase({
        venue,
        grams: g,
        buy_price_per_gram: pricePerGram,
        purchased_at: purchasedAt,
        notes,
      });
    } else {
      await updateGoldPurchase(id, {
        grams: g,
        buy_price_per_gram: pricePerGram,
        notes,
        purchased_at: purchasedAt,
      });
    }
    setEditing(null);
    setCreating(false);
    setErr(null);
    router.refresh();
  }

  async function saveSell(venue: string, grams: string, price: string, notes: string, soldAt: string) {
    const g = Number(grams) || 0;
    const pricePerGram = Number(price) || 0;
    const net = netGramsByVenue.get(venue) ?? 0;
    if (g > net + 1e-9) {
      setErr(`Cannot sell more than ${grams4(net)} g held in ${venue}`);
      throw new Error("oversell");
    }
    await insertGoldPurchase({
      venue,
      grams: g,
      buy_price_per_gram: pricePerGram,
      purchased_at: new Date(soldAt).toISOString(),
      notes,
      side: "SELL",
    });
    setSelling(false);
    setErr(null);
    router.refresh();
  }

  async function deactivate(id: number) {
    await deactivateGoldPurchase(id);
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-tprimary">Gold</h1>
          {fresh && <p className="mt-0.5 text-[11px] text-tdim">synced {fmtAgo(fresh)} · cermati</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={refetchPrices}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-tmuted hover:text-tprimary disabled:opacity-60"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refetching…" : "Refetch prices"}
          </button>
          {heldVenues.length > 0 && (
            <button
              onClick={() => {
                setSelling(true);
                setErr(null);
              }}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm font-semibold text-tmuted hover:text-tprimary"
            >
              <Minus size={14} strokeWidth={2} />
              Sell
            </button>
          )}
          <button
            onClick={() => {
              setCreating(true);
              setErr(null);
            }}
            className="flex items-center gap-1.5 rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page"
          >
            <Plus size={14} strokeWidth={2} />
            Add Purchase
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-critical">{err}</p>}

      {purchases.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Net Weight" value={`${grams4(netGrams)} g`} />
          <MetricCard label="Cost" value={fmtIdrCompact(costBasis)} fullValue={fmtIdr(costBasis)} />
          <MetricCard label="Market Value" value={hasValue ? fmtIdrCompact(marketValue) : "N/A"} fullValue={hasValue ? fmtIdr(marketValue) : "N/A"} />
          <MetricCard
            label="Unrealized P&L"
            value={unrealizedPnl == null ? "N/A" : `${unrealizedPnl >= 0 ? "+" : ""}${fmtIdrCompact(unrealizedPnl)}`}
            fullValue={unrealizedPnl == null ? "N/A" : `${unrealizedPnl >= 0 ? "+" : ""}${fmtIdr(unrealizedPnl)}`}
            sub={unrealizedPnlPct != null ? `${unrealizedPnlPct >= 0 ? "+" : ""}${unrealizedPnlPct.toFixed(1)}%` : undefined}
            color={unrealizedPnl == null ? undefined : unrealizedPnl >= 0 ? "up" : "down"}
            glyph={unrealizedPnl == null ? undefined : dirGlyph(unrealizedPnl)}
          />
          <MetricCard
            label="Realized P&L"
            value={`${realizedPnl >= 0 ? "+" : ""}${fmtIdrCompact(realizedPnl)}`}
            fullValue={`${realizedPnl >= 0 ? "+" : ""}${fmtIdr(realizedPnl)}`}
            color={realizedPnl >= 0 ? "up" : "down"}
            glyph={dirGlyph(realizedPnl)}
          />
        </div>
      )}

      {prices.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {prices.flatMap((pr) => [
            <MetricCard key={`${pr.venue}-buy`} label={`${pr.venue} Buy`} value={fmtIdrCompact(pr.buy_price)} fullValue={fmtIdr(pr.buy_price)} />,
            <MetricCard key={`${pr.venue}-sell`} label={`${pr.venue} Sell`} value={fmtIdrCompact(pr.sell_price)} fullValue={fmtIdr(pr.sell_price)} />,
          ])}
        </div>
      )}

      {creating && (
        <Modal title="Add Purchase" onClose={() => setCreating(false)}>
          <GoldForm
            venues={venues}
            onCancel={() => setCreating(false)}
            onSave={(v) => save(null, v.venue, v.grams, v.price, v.notes, v.purchased)}
          />
        </Modal>
      )}

      {selling && (
        <Modal title="Sell Gold" onClose={() => setSelling(false)}>
          <GoldForm
            mode="sell"
            venues={heldVenues}
            onCancel={() => setSelling(false)}
            onSave={(v) => saveSell(v.venue, v.grams, v.price, v.notes, v.purchased)}
          />
        </Modal>
      )}

      {purchases.length === 0 ? (
        <EmptyState message="No active gold purchases." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {pageItems.map(({ p, side, rowAmount, value, pnl, pnlPct }) => (
              <div key={p.id} className="rounded-lg border border-edge bg-component p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-medium capitalize text-tprimary">{p.venue}</span>
                    {side === "SELL" && (
                      <span className="rounded-full border border-down/30 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-down">
                        Sell
                      </span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {pnlPct != null && (
                      <span className={`text-xs font-medium ${pnlPct >= 0 ? "text-up" : "text-down"}`}>
                        {`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`}
                      </span>
                    )}
                    <button
                      onClick={() => setEditing({
                        id: p.id,
                        grams: String(p.grams),
                        price: String(p.buy_price_per_gram),
                        cost: String(Math.round(p.grams * p.buy_price_per_gram)),
                        notes: p.notes ?? "",
                        purchased: toLocalInput(new Date(p.purchased_at)),
                      })}
                      className="text-xs text-tdim hover:text-tprimary"
                    >Edit</button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-tdim">Grams </span><span className="num text-tprimary">{grams4(p.grams)}</span></div>
                  <div><span className="text-tdim">{side === "SELL" ? "Sell/g " : "Buy/g "}</span><span className="num text-tprimary">{fmtIdr(p.buy_price_per_gram, 2)}</span></div>
                  <div><span className="text-tdim">{side === "SELL" ? "Proceeds " : "Cost "}</span><span className="num text-tprimary">{fmtIdr(rowAmount)}</span></div>
                  <div><span className="text-tdim">Value </span><span className="num text-tprimary">{value != null ? fmtIdr(value) : "—"}</span></div>
                  {side === "BUY" && (
                    <div className="col-span-2">
                      <span className="text-tdim">P&amp;L </span>
                      <span className={pnl == null ? "num text-tdim" : `num ${pnl >= 0 ? "text-up" : "text-down"}`}>
                        {pnl == null ? "—" : `${dirGlyph(pnl)} ${pnl >= 0 ? "+" : ""}${fmtIdr(pnl)}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4 text-left">VENUE</th>
                  <th className="pb-2 pr-4 text-right">GRAMS</th>
                  <th className="pb-2 pr-4 text-right">PRICE/G</th>
                  <th className="pb-2 pr-4 text-right">COST / PROCEEDS</th>
                  <th className="pb-2 pr-4 text-right">VALUE</th>
                  <th className="pb-2 pr-4 text-right">P&amp;L</th>
                  <th className="pb-2 pl-6 pr-4 text-left">DATE</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(({ p, side, rowAmount, value, pnl, pnlPct }) => (
                  <tr key={p.id} className="border-t border-edge">
                    <td className="py-2 pr-4 font-medium text-tprimary">
                      <span className="capitalize">{p.venue}</span>
                      {side === "SELL" && (
                        <span className="ml-2 rounded-full border border-down/30 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-down">
                          Sell
                        </span>
                      )}
                    </td>
                    <td className="num py-2 pr-4 text-right">{grams4(p.grams)}</td>
                    <td className="num py-2 pr-4 text-right">{fmtIdr(p.buy_price_per_gram, 2)}</td>
                    <td className="num py-2 pr-4 text-right text-tmuted">{fmtIdr(rowAmount)}</td>
                    <td className="num py-2 pr-4 text-right">{value != null ? fmtIdr(value) : "—"}</td>
                    <td className="num whitespace-nowrap py-2 pr-4 text-right">
                      <span className={pnl == null ? "text-tdim" : pnl >= 0 ? "text-up" : "text-down"}>
                        {pnl == null ? "—" : `${dirGlyph(pnl)} ${pnl >= 0 ? "+" : ""}${fmtIdr(pnl)}`}
                      </span>
                      {pnlPct != null && (
                        <span className={`ml-1 text-xs ${pnlPct >= 0 ? "text-up" : "text-down"}`}>
                          ({`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pl-6 pr-4 text-tmuted">{fmtWib(p.purchased_at)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => setEditing({
                          id: p.id,
                          grams: String(p.grams),
                          price: String(p.buy_price_per_gram),
                          cost: String(Math.round(p.grams * p.buy_price_per_gram)),
                          notes: p.notes ?? "",
                          purchased: toLocalInput(new Date(p.purchased_at)),
                        })}
                        className="text-xs text-tdim hover:text-tprimary"
                      >Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totalPages} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
        </>
      )}

      {editing && (
        <Modal title="Edit Purchase" onClose={() => setEditing(null)}>
          <GoldForm
            venues={venues}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={(v) => save(editing.id, v.venue, v.grams, v.price, v.notes, v.purchased)}
            onDeactivate={() => deactivate(editing.id)}
          />
        </Modal>
      )}
    </div>
  );
}

// Three mutually-derivable fields: grams * price/gram = total cost. The user
// can fill any two; the third is recomputed live from whichever two fields
// were most recently edited (so it's never locked, just kept consistent).
type AmountField = "grams" | "price" | "cost";
type AmountFields = { grams: string; price: string; cost: string };

const parseNum = (s: string): number | null => {
  const n = Number(s);
  return s.trim() !== "" && !Number.isNaN(n) ? n : null;
};
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

function deriveAmountFields(
  field: AmountField,
  raw: string,
  fields: AmountFields,
  touched: AmountField[],
): { fields: AmountFields; touched: AmountField[] } {
  const nextTouched = [field, ...touched.filter((f) => f !== field)].slice(0, 2) as AmountField[];
  const next: AmountFields = { ...fields, [field]: raw };

  if (nextTouched.length === 2) {
    const derived = (["grams", "price", "cost"] as const).find((f) => !nextTouched.includes(f));
    const g = parseNum(next.grams);
    const pr = parseNum(next.price);
    const c = parseNum(next.cost);
    if (derived === "cost" && g != null && pr != null) {
      next.cost = String(round(g * pr, 0));
    } else if (derived === "price" && g != null && c != null && g > 0) {
      next.price = String(round(c / g, 2));
    } else if (derived === "grams" && pr != null && c != null && pr > 0) {
      next.grams = String(round(c / pr, 10));
    }
  }
  return { fields: next, touched: nextTouched };
}

function GoldForm({
  mode = "buy",
  venues,
  initial,
  onCancel,
  onSave,
  onDeactivate,
}: {
  mode?: "buy" | "sell";
  venues: string[];
  initial?: { id: number; grams: string; price: string; cost: string; notes: string; purchased: string };
  onCancel: () => void;
  onSave: (v: {
    venue: string;
    grams: string;
    price: string;
    notes: string;
    purchased: string;
  }) => Promise<void>;
  onDeactivate?: () => Promise<void>;
}) {
  const isSell = mode === "sell";
  const isEdit = !!initial;
  const [venue, setVenue] = useState(venues[0] ?? "");
  const [fields, setFields] = useState<AmountFields>({
    grams: initial?.grams ?? "",
    price: initial?.price ?? "",
    cost: initial?.cost ?? "",
  });
  const [touched, setTouched] = useState<AmountField[]>(initial ? ["grams", "price"] : []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [purchased, setPurchased] = useState(initial?.purchased ?? nowLocalInput());
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  function setAmount(field: AmountField, raw: string) {
    const next = deriveAmountFields(field, raw, fields, touched);
    setFields(next.fields);
    setTouched(next.touched);
  }

  const grams = parseNum(fields.grams);
  const price = parseNum(fields.price);

  async function run(kind: "save" | "remove", fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch {
      setBusy(null); // failure: re-enable so the user can retry
    }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {!isEdit && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Venue</span>
            <select
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            >
              {venues.length === 0 && <option value="">No venues available</option>}
              {venues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Purchase Date &amp; Time</span>
          <input
            type="datetime-local"
            value={purchased}
            onChange={(e) => setPurchased(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Grams</span>
            <input
              type="number"
              value={fields.grams}
              onChange={(e) => setAmount("grams", e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">{isSell ? "Sell Price per Gram (IDR)" : "Price per Gram (IDR)"}</span>
            <input
              type="number"
              value={fields.price}
              onChange={(e) => setAmount("price", e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">{isSell ? "Proceeds (IDR)" : "Total Cost (IDR)"}</span>
            <input
              type="number"
              value={fields.cost}
              onChange={(e) => setAmount("cost", e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-tdim">Notes <span className="text-tdim opacity-60">optional</span></span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() =>
            run("save", () => onSave({ venue, grams: fields.grams, price: fields.price, notes, purchased }))
          }
          disabled={!venue || grams == null || grams <= 0 || price == null || price <= 0 || busy !== null}
          className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} disabled={busy !== null} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">
          Cancel
        </button>
        {onDeactivate && (
          <button
            onClick={() => run("remove", onDeactivate)}
            disabled={busy !== null}
            className="ml-auto rounded-md px-3 py-1.5 text-sm text-down hover:underline disabled:opacity-60"
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
    </div>
  );
}
