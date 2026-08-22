"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ArrowLeftRight, Trash2 } from "lucide-react";
import {
  insertPriceRefreshRequest, pollLatestSnapshotTime,
  insertStockTransaction, insertStockDividend, deactivatePosition,
} from "@/app/actions";
import { calcPnl, fmtIdr, fmtIdrCompact, fmtAgo, dirGlyph, newestFetchedAt, normalizeTicker, displayTicker } from "@/lib/format";
import type { Position, Snapshot, Analysis, StockDividend } from "@/lib/types";
import MetricCard from "@/components/MetricCard";
import RecommendationBadge from "@/components/RecommendationBadge";
import EmptyState from "@/components/EmptyState";
import Modal from "@/components/Modal";
import { MiniSparkline } from "@/components/Sparkline";

const TICKER_RE = /^[A-Z0-9]{1,10}$/;
const SHARES_PER_LOT = 100;

// datetime-local input value (YYYY-MM-DDTHH:mm) in the browser's local time.
const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const nowLocalInput = () => toLocalInput(new Date());

// One modal, three tabs. `editable` allows typing a ticker (add-new flow from
// the header Buy button); per-row triggers lock the ticker and expose all tabs.
type TradeTab = "buy" | "sell" | "dividend";
type TradeModal = { ticker: string; editable: boolean; tab: TradeTab } | null;

// Desktop table columns. `col` = sort key (null = not sortable); `tip` shows as
// a hover tooltip on the header. `align`/`pr` are full Tailwind classes so JIT
// keeps them.
const COLUMNS: { col: string | null; label: string; tip: string; align: string; pr?: string }[] = [
  { col: "ticker", label: "TICKER", tip: "Stock ticker (IDX code) — click to open detail", align: "text-left" },
  { col: "lots", label: "LOTS", tip: "Lots held (1 lot = 100 shares)", align: "text-right" },
  { col: "price", label: "PRICE", tip: "Latest market price per share", align: "text-right" },
  { col: "pnl", label: "AVG / P&L", tip: "Average buy price and unrealized profit/loss %", align: "text-right" },
  { col: null, label: "TREND", tip: "Recent price trend (sparkline)", align: "text-right" },
  { col: "invested", label: "INVESTED", tip: "Total cost basis (avg price × shares held)", align: "text-right" },
  { col: "mktValue", label: "MKT VALUE", tip: "Current market value (price × shares held)", align: "text-right" },
  { col: "realized", label: "REALIZED", tip: "Realized profit/loss booked from sells", align: "text-right" },
  { col: "income", label: "INCOME", tip: "Total dividend income received", align: "text-right", pr: "pr-6" },
  { col: "recommendation", label: "RECOMMENDATION", tip: "Latest AI recommendation", align: "text-left" },
];

export default function PortfolioClient({
  positions,
  snaps,
  recs,
  history,
  dividends,
}: {
  positions: Position[];
  snaps: Snapshot[];
  recs: Pick<Analysis, "ticker" | "recommendation">[];
  history: Record<string, number[]>;
  dividends: StockDividend[];
}) {
  const router = useRouter();
  const snapBy = new Map(snaps.map((s) => [s.ticker.toUpperCase(), s]));
  const recBy = new Map(recs.map((r) => [r.ticker.toUpperCase(), r.recommendation]));
  const posBy = new Map(positions.map((p) => [p.ticker.toUpperCase(), p]));
  const fresh = newestFetchedAt(snaps);

  const incomeByTicker = new Map<string, number>();
  for (const d of dividends) {
    const t = d.ticker.toUpperCase();
    incomeByTicker.set(t, (incomeByTicker.get(t) ?? 0) + (d.amount || 0));
  }
  const totalDividends = dividends.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalRealized = positions.reduce((sum, p) => sum + (p.realized_pnl ?? 0), 0);

  let totalInvested = 0;
  let totalMktValue = 0;
  for (const p of positions) {
    const avg = p.avg_price ?? 0;
    const lots = p.lots ?? 0;
    const qty = lots * SHARES_PER_LOT;
    if (avg && qty) totalInvested += avg * qty;
    const cur = snapBy.get(p.ticker.toUpperCase())?.current_price ?? 0;
    if (cur && qty) totalMktValue += cur * qty;
  }
  const totalPnl = totalMktValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : null;
  const hasMktValue = totalMktValue > 0;

  const [tradeModal, setTradeModal] = useState<TradeModal>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "ticker", dir: "asc" });

  function toggleSort(col: string) {
    // First click on a column sorts descending (except ticker, which reads
    // naturally ascending); clicking the active column flips direction.
    setSort((s) =>
      s.col === col
        ? { col, dir: s.dir === "asc" ? "desc" : "asc" }
        : { col, dir: col === "ticker" ? "asc" : "desc" },
    );
  }

  // Sort key for a position by column. Nulls sort to the bottom regardless of
  // direction by using -Infinity (they flip with dir, which is acceptable here).
  const sortVal = (p: Position, col: string): number | string => {
    const t = p.ticker.toUpperCase();
    const cur = snapBy.get(t)?.current_price ?? 0;
    const avg = p.avg_price ?? 0;
    const lots = p.lots ?? 0;
    const qty = lots * SHARES_PER_LOT;
    switch (col) {
      case "ticker": return t;
      case "lots": return lots;
      case "price": return cur;
      case "pnl": return cur && avg ? calcPnl(cur, avg, lots).pnlPct : -Infinity;
      case "invested": return avg && qty ? avg * qty : 0;
      case "mktValue": return cur && qty ? cur * qty : 0;
      case "realized": return p.realized_pnl ?? -Infinity;
      case "income": return incomeByTicker.get(t) ?? 0;
      case "recommendation": return recBy.get(t) ?? "";
      default: return 0;
    }
  };

  const sortedPositions = [...positions].sort((a, b) => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const av = sortVal(a, sort.col);
    const bv = sortVal(b, sort.col);
    return typeof av === "string" || typeof bv === "string"
      ? dir * String(av).localeCompare(String(bv))
      : dir * (av - bv);
  });

  // Guard the refetch poll against firing after the component unmounts.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function refetchPrices() {
    setRefreshing(true);
    setErr(null);
    const baseline = fresh;
    try { await insertPriceRefreshRequest(); } catch (e) { setErr(String(e)); setRefreshing(false); return; }
    const deadline = Date.now() + 30000;
    const tick = async () => {
      if (!alive.current) return;
      const newest = await pollLatestSnapshotTime();
      const done = (newest && (!baseline || newest > baseline)) || Date.now() > deadline;
      if (!alive.current) return;
      if (done) { router.refresh(); setRefreshing(false); return; }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
  }

  async function insertTxn(
    ticker: string,
    side: "BUY" | "SELL",
    lots: string,
    price: string,
    date: string,
    notes: string,
    fee: string,
  ) {
    // validate the plain code, store the yahoo symbol (.JK)
    const plain = displayTicker(ticker);
    if (!TICKER_RE.test(plain)) {
      setErr(`Invalid ticker: ${plain}`);
      throw new Error("invalid"); // keep the form open + re-enable Save
    }
    // Reject overselling at the source: the ledger fold silently caps a SELL at
    // the lots held, so a too-large SELL would otherwise be recorded as bad data
    // with understated realized P&L instead of being rejected.
    if (side === "SELL") {
      const heldLots = posBy.get(normalizeTicker(plain).toUpperCase())?.lots ?? 0;
      if ((Number(lots) || 0) > heldLots) {
        setErr(`Cannot sell ${lots} lots — only ${heldLots} held`);
        throw new Error("oversell"); // keep the form open + re-enable Save
      }
    }
    try {
      await insertStockTransaction({
        ticker: normalizeTicker(plain),
        side,
        lots: Number(lots) || 0,
        price: Number(price) || 0,
        fee: Number(fee) || 0,
        txn_at: new Date(date).toISOString(),
        notes,
      });
    } catch (e) { setErr(String(e)); throw e; }
    setTradeModal(null);
    setErr(null);
    router.refresh();
  }

  async function insertDividend(
    ticker: string,
    amount: string,
    perShare: string,
    paidAt: string,
    notes: string,
  ) {
    try {
      await insertStockDividend({
        ticker: normalizeTicker(ticker),
        amount: Number(amount) || 0,
        per_share: perShare.trim() !== "" ? Number(perShare) : null,
        paid_at: paidAt,
        notes,
      });
    } catch (e) { setErr(String(e)); throw e; }
    setTradeModal(null);
    setErr(null);
    router.refresh();
  }

  async function deactivate(ticker: string) {
    try { await deactivatePosition(normalizeTicker(ticker)); } catch (e) { setErr(String(e)); return; }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-medium text-tprimary">Portfolio</h1>
          {fresh && <p className="mt-0.5 text-[11px] text-tdim">synced {fmtAgo(fresh)} · yfinance</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={refetchPrices}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-tmuted hover:text-tprimary disabled:opacity-60"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refetching…" : "Refetch prices"}
          </button>
          <button
            onClick={() => { setTradeModal({ ticker: "", editable: true, tab: "buy" }); setErr(null); }}
            className="flex items-center gap-1.5 rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page"
          >
            <Plus size={14} strokeWidth={2} />
            Buy
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-critical">{err}</p>}

      {positions.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Invested" value={totalInvested > 0 ? fmtIdrCompact(totalInvested) : "N/A"} fullValue={totalInvested > 0 ? fmtIdr(totalInvested) : "N/A"} />
          <MetricCard label="Market Value" value={hasMktValue ? fmtIdrCompact(totalMktValue) : "N/A"} fullValue={hasMktValue ? fmtIdr(totalMktValue) : "N/A"} />
          <MetricCard
            label="Total P&L"
            value={!hasMktValue ? "N/A" : `${totalPnl >= 0 ? "+" : ""}${fmtIdrCompact(totalPnl)}`}
            fullValue={!hasMktValue ? "N/A" : `${totalPnl >= 0 ? "+" : ""}${fmtIdr(totalPnl)}`}
            sub={hasMktValue && totalPnlPct != null ? `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%` : undefined}
            color={!hasMktValue ? undefined : totalPnl >= 0 ? "up" : "down"}
            glyph={!hasMktValue ? undefined : dirGlyph(totalPnl)}
          />
          <MetricCard label="Positions" value={String(positions.length)} />
          <MetricCard
            label="Realized"
            value={`${totalRealized >= 0 ? "+" : ""}${fmtIdrCompact(totalRealized)}`}
            fullValue={`${totalRealized >= 0 ? "+" : ""}${fmtIdr(totalRealized)}`}
            color={totalRealized >= 0 ? "up" : "down"}
            glyph={dirGlyph(totalRealized)}
          />
          <MetricCard label="Dividends" value={fmtIdrCompact(totalDividends)} fullValue={fmtIdr(totalDividends)} />
        </div>
      )}

      {tradeModal && (
        <Modal title={tradeModal.ticker ? displayTicker(tradeModal.ticker) : "Buy"} onClose={() => setTradeModal(null)}>
          <TradeTabs
            ticker={tradeModal.ticker}
            editable={tradeModal.editable}
            initialTab={tradeModal.tab}
            currentLots={posBy.get(tradeModal.ticker)?.lots ?? 0}
            onClose={() => setTradeModal(null)}
            onBuy={(v) => insertTxn(tradeModal.ticker || v.ticker, "BUY", v.lots, v.price, v.date, v.notes, v.fee)}
            onSell={(v) => insertTxn(tradeModal.ticker, "SELL", v.lots, v.price, v.date, v.notes, v.fee)}
            onDividend={(v) => insertDividend(tradeModal.ticker, v.amount, v.perShare, v.paidAt, v.notes)}
          />
        </Modal>
      )}

      {positions.length === 0 ? (
        <EmptyState message="No active positions." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {sortedPositions.map((p) => {
              const t = p.ticker.toUpperCase();
              const cur = snapBy.get(t)?.current_price ?? 0;
              const avg = p.avg_price ?? 0;
              const lots = p.lots ?? 0;
              const qty = lots * SHARES_PER_LOT;
              const invested = avg && qty ? avg * qty : 0;
              const mktValue = cur && qty ? cur * qty : 0;
              const pnl = cur && avg ? calcPnl(cur, avg, lots).pnlPct : null;
              const realized = p.realized_pnl;
              const income = incomeByTicker.get(t) ?? 0;
              return (
                <div key={t} className="rounded-lg border border-edge bg-component p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/stocks?ticker=${displayTicker(t)}`} className="font-medium text-accent hover:underline">{displayTicker(t)}</Link>
                      {lots > 0 && <span className="ml-2 text-xs text-tdim">{lots.toLocaleString("id-ID")} lots</span>}
                    </div>
                    <RecommendationBadge rec={recBy.get(t)} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-tdim">Price </span>
                      <span className="num text-tprimary">{cur ? fmtIdr(cur) : "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-tdim">Avg </span>
                      <span className="num text-tprimary">{avg ? fmtIdr(avg, 2) : "N/A"}</span>{" "}
                      {pnl != null && (
                        <span className={pnl >= 0 ? "text-up" : "text-down"}>
                          {`${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-tdim">Invested </span>
                      <span className="num text-tprimary">{invested ? fmtIdr(invested) : "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-tdim">Value </span>
                      <span className="num text-tprimary">{mktValue ? fmtIdr(mktValue) : "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-tdim">Realized </span>
                      <span className={`num ${realized == null ? "text-tprimary" : realized >= 0 ? "text-up" : "text-down"}`}>
                        {realized == null ? "N/A" : fmtIdr(realized)}
                      </span>
                    </div>
                    <div>
                      <span className="text-tdim">Income </span>
                      <span className="num text-tprimary">{income ? fmtIdr(income) : "N/A"}</span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-edge/50 pt-2 text-xs font-medium">
                    <button onClick={() => { setTradeModal({ ticker: t, editable: false, tab: "buy" }); setErr(null); }} className="rounded border border-edge px-2.5 py-1 text-tmuted hover:text-tprimary">Trade</button>
                    <button onClick={() => deactivate(t)} className="rounded px-2.5 py-1 text-down hover:bg-page">Remove</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  {COLUMNS.map((c) => {
                    const active = c.col != null && sort.col === c.col;
                    return (
                      <th
                        key={c.label}
                        title={c.tip}
                        onClick={c.col ? () => toggleSort(c.col!) : undefined}
                        className={`pb-2 ${c.pr ?? "pr-4"} ${c.align} ${c.col ? "cursor-pointer select-none hover:text-tprimary" : ""} ${active ? "text-tprimary" : ""}`}
                      >
                        {c.label}{active ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                      </th>
                    );
                  })}
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedPositions.map((p) => {
                  const t = p.ticker.toUpperCase();
                  const cur = snapBy.get(t)?.current_price ?? 0;
                  const avg = p.avg_price ?? 0;
                  const lots = p.lots ?? 0;
                  const qty = lots * SHARES_PER_LOT;
                  const invested = avg && qty ? avg * qty : 0;
                  const mktValue = cur && qty ? cur * qty : 0;
                  const pnl = cur && avg ? calcPnl(cur, avg, lots).pnlPct : null;
                  const realized = p.realized_pnl;
                  const income = incomeByTicker.get(t) ?? 0;
                  return (
                    <tr key={t} className="border-t border-edge">
                      <td className="py-2 pr-4">
                        <Link href={`/stocks?ticker=${displayTicker(t)}`} className="font-medium text-accent hover:underline">{displayTicker(t)}</Link>
                      </td>
                      <td className="num py-2 pr-4 text-right">{lots ? lots.toLocaleString("id-ID") : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">{cur ? fmtIdr(cur) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">
                        <span className="text-tmuted">{avg ? fmtIdr(avg, 2) : "N/A"}</span>{" "}
                        <span className={pnl == null ? "text-tdim" : pnl >= 0 ? "text-up" : "text-down"}>
                          {pnl == null ? "N/A" : `${dirGlyph(pnl)} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right"><MiniSparkline prices={history[t]} /></td>
                      <td className="num py-2 pr-4 text-right text-tmuted">{invested ? fmtIdr(invested) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">{mktValue ? fmtIdr(mktValue) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">
                        <span className={realized == null ? "text-tdim" : realized >= 0 ? "text-up" : "text-down"}>
                          {realized == null ? "N/A" : fmtIdr(realized)}
                        </span>
                      </td>
                      <td className="num py-2 pr-6 text-right text-tmuted">{income ? fmtIdr(income) : "N/A"}</td>
                      <td className="py-2 pr-4"><RecommendationBadge rec={recBy.get(t)} /></td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setTradeModal({ ticker: t, editable: false, tab: "buy" }); setErr(null); }}
                            title="Buy / Sell / Dividend"
                            aria-label={`Trade ${t}`}
                            className="rounded p-1 text-tdim hover:bg-component hover:text-tprimary"
                          >
                            <ArrowLeftRight size={15} strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => deactivate(t)}
                            title="Remove position"
                            aria-label={`Remove ${t}`}
                            className="rounded p-1 text-tdim hover:bg-component hover:text-down"
                          >
                            <Trash2 size={15} strokeWidth={1.5} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Tabbed shell over the existing Buy/Sell/Dividend forms. Sell and Dividend
// only apply to an existing position, so the add-new flow (empty ticker) shows
// the Buy form alone with no tab bar.
function TradeTabs({
  ticker,
  editable,
  initialTab,
  currentLots,
  onClose,
  onBuy,
  onSell,
  onDividend,
}: {
  ticker: string;
  editable: boolean;
  initialTab: TradeTab;
  currentLots: number;
  onClose: () => void;
  onBuy: (v: { ticker: string; lots: string; price: string; date: string; notes: string; fee: string }) => Promise<void>;
  onSell: (v: { ticker: string; lots: string; price: string; date: string; notes: string; fee: string }) => Promise<void>;
  onDividend: (v: { amount: string; perShare: string; paidAt: string; notes: string }) => Promise<void>;
}) {
  const [tab, setTab] = useState<TradeTab>(ticker ? initialTab : "buy");
  const tabs: { key: TradeTab; label: string }[] = [
    { key: "buy", label: "Buy" },
    { key: "sell", label: "Sell" },
    { key: "dividend", label: "Dividend" },
  ];

  return (
    <div>
      {ticker && (
        <div className="mb-4 flex gap-1 border-b border-edge">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
                tab === tb.key
                  ? "border-accent text-tprimary"
                  : "border-transparent text-tdim hover:text-tmuted"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      )}
      {tab === "buy" && (
        <TxnForm side="BUY" ticker={ticker} tickerEditable={editable} onCancel={onClose} onSave={onBuy} />
      )}
      {tab === "sell" && (
        <TxnForm side="SELL" ticker={ticker} currentLots={currentLots} onCancel={onClose} onSave={onSell} />
      )}
      {tab === "dividend" && <DividendForm onCancel={onClose} onSave={onDividend} />}
    </div>
  );
}

function TxnForm({
  side,
  ticker,
  tickerEditable,
  currentLots,
  onCancel,
  onSave,
}: {
  side: "BUY" | "SELL";
  ticker: string;
  tickerEditable?: boolean;
  currentLots?: number;
  onCancel: () => void;
  onSave: (v: { ticker: string; lots: string; price: string; date: string; notes: string; fee: string }) => Promise<void>;
}) {
  const [tickerVal, setTickerVal] = useState(ticker);
  const [lots, setLots] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(nowLocalInput());
  const [notes, setNotes] = useState("");
  const [fee, setFee] = useState("0");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const cls = "rounded-md border border-edge bg-page px-3 py-2 text-tprimary";

  async function submit() {
    setLocalErr(null);
    if (side === "SELL" && currentLots != null && (Number(lots) || 0) > currentLots) {
      setLocalErr(`Cannot sell more than ${currentLots} lots held`);
      return;
    }
    setBusy(true);
    try {
      await onSave({ ticker: tickerVal, lots, price, date, notes, fee });
    } catch {
      setBusy(false); // failure: re-enable so the user can retry
    }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Ticker</span>
          <input
            placeholder="e.g. BBCA"
            value={tickerVal}
            onChange={(e) => setTickerVal(e.target.value.toUpperCase())}
            readOnly={!tickerEditable}
            className={`${cls} ${!tickerEditable ? "opacity-70" : ""}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Date &amp; Time</span>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Lots</span>
          <input type="number" value={lots} onChange={(e) => setLots(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Price per Share (IDR)</span>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Fee (IDR) <span className="text-tdim opacity-60">optional</span></span>
          <input type="number" value={fee} onChange={(e) => setFee(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-tdim">Notes <span className="text-tdim opacity-60">optional</span></span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={cls} />
        </label>
      </div>
      {localErr && <p className="mt-2 text-sm text-critical">{localErr}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:opacity-60"
        >
          {busy ? "Saving…" : side === "BUY" ? "Buy" : "Sell"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">Cancel</button>
      </div>
    </div>
  );
}

function DividendForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (v: { amount: string; perShare: string; paidAt: string; notes: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [perShare, setPerShare] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const cls = "rounded-md border border-edge bg-page px-3 py-2 text-tprimary";

  async function submit() {
    setBusy(true);
    try {
      await onSave({ amount, perShare, paidAt, notes });
    } catch {
      setBusy(false); // failure: re-enable so the user can retry
    }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Amount (IDR)</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Per Share (IDR) <span className="text-tdim opacity-60">optional</span></span>
          <input type="number" value={perShare} onChange={(e) => setPerShare(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Paid Date</span>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-tdim">Notes <span className="text-tdim opacity-60">optional</span></span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={cls} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">Cancel</button>
      </div>
    </div>
  );
}
