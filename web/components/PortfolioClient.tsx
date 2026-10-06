"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ArrowLeftRight, Trash2, ChevronDown } from "lucide-react";
import {
  insertPriceRefreshRequest, pollLatestSnapshotTime,
  insertStockTransaction, insertStockDividend, deactivatePosition,
} from "@/app/actions";
import { calcPnl } from "@folionix/lib";
import { fmtIdr, fmtIdrCompact, fmtNum, fmtSigned, fmtAgo, dirGlyph, newestFetchedAt, normalizeTicker, displayTicker, tone } from "@/lib/format";
import type { Position, Snapshot, Analysis, StockDividend } from "@/lib/types";
import MetricCard from "@/components/MetricCard";
import RecommendationBadge from "@/components/RecommendationBadge";
import EmptyState from "@/components/EmptyState";
import Modal, { ConfirmDialog } from "@/components/Modal";
import { MiniSparkline } from "@/components/Sparkline";
import Delta from "@/components/Delta";
import PeerPanel from "@/components/PeerPanel";
import type { PeerRow, Valuation } from "@/lib/peers";
import SortTh from "@/components/SortTh";
import { Field, Form, FormActions, PrimaryButton, inputCls, SecondaryButton, useAsyncAction } from "@/components/Form";
import { useSort, compareBy } from "@/lib/useSort";
import { useRefetchPoll } from "@/lib/useRefetchPoll";

const TICKER_RE = /^[A-Z0-9]{1,10}$/;
const SHARES_PER_LOT = 100;

// datetime-local input value (YYYY-MM-DDTHH:mm) in the browser's local time.
const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const nowLocalInput = () => toLocalInput(new Date());

// One modal, three tabs. `editable` allows typing a ticker (add-new flow from
// the header Buy button); per-row triggers lock the ticker and expose all tabs.
type TradeTab = "buy" | "sell" | "dividend";
type TradeModal = { ticker: string; editable: boolean; tab: TradeTab; prefill?: string } | null;

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
  initialBuy,
  peers,
  valuations,
}: {
  positions: Position[];
  snaps: Snapshot[];
  recs: Pick<Analysis, "ticker" | "recommendation">[];
  history: Record<string, number[]>;
  dividends: StockDividend[];
  /** Plain ticker from `/stocks?buy=XXXX` (TickerDetail's Buy): opens the buy dialog prefilled. */
  initialBuy?: string;
  /** stock_peers rows of active holdings (ticker = the holding), rank-ordered. */
  peers: PeerRow[];
  valuations: Valuation[];
}) {
  const router = useRouter();
  const snapBy = new Map(snaps.map((s) => [s.ticker.toUpperCase(), s]));
  const recBy = new Map(recs.map((r) => [r.ticker.toUpperCase(), r.recommendation]));
  const posBy = new Map(positions.map((p) => [p.ticker.toUpperCase(), p]));
  const fresh = newestFetchedAt(snaps);
  const valBy = new Map(valuations.map((v) => [v.ticker.toUpperCase(), v]));
  const peersBy = new Map<string, PeerRow[]>();
  for (const pr of peers) {
    const t = pr.ticker.toUpperCase();
    peersBy.set(t, [...(peersBy.get(t) ?? []), pr]);
  }
  // One expanded Peers row at a time keeps the table scannable.
  const [openPeers, setOpenPeers] = useState<string | null>(null);
  const togglePeers = (t: string) => setOpenPeers((cur) => (cur === t ? null : t));

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

  const [tradeModal, setTradeModal] = useState<TradeModal>(() => {
    const plain = initialBuy ? displayTicker(initialBuy) : "";
    return TICKER_RE.test(plain) ? { ticker: "", editable: true, tab: "buy", prefill: plain } : null;
  });
  const [removing, setRemoving] = useState<string | null>(null);
  // Text columns read naturally ascending on first click; numbers descending.
  const { sort, toggle: toggleSort } = useSort({ col: "ticker", dir: "asc" }, ["ticker", "recommendation"]);
  const { refreshing, status: refetchStatus, refetch: refetchPrices } = useRefetchPoll(
    () => insertPriceRefreshRequest(),
    pollLatestSnapshotTime,
    fresh,
  );

  // Sort key for a position by column. Nulls sort to the bottom regardless of
  // direction by using -Infinity (they flip with dir, which is acceptable here).
  const sortVal = (p: Position, col: string): number | string | null => {
    const t = p.ticker.toUpperCase();
    const cur = snapBy.get(t)?.current_price ?? 0;
    const avg = p.avg_price ?? 0;
    const lots = p.lots ?? 0;
    const qty = lots * SHARES_PER_LOT;
    switch (col) {
      case "ticker": return t;
      case "lots": return lots;
      case "price": return cur;
      case "pnl": return cur && avg ? calcPnl(cur, avg, lots).pnlPct : null;
      case "invested": return avg && qty ? avg * qty : 0;
      case "mktValue": return cur && qty ? cur * qty : 0;
      case "realized": return p.realized_pnl ?? null;
      case "income": return incomeByTicker.get(t) ?? 0;
      case "recommendation": return recBy.get(t) ?? "";
      default: return 0;
    }
  };

  const sortedPositions = [...positions].sort((a, b) => compareBy(sortVal(a, sort.col), sortVal(b, sort.col), sort.dir));

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
    // Thrown messages render inside the dialog (FormActions); the form stays open.
    if (!TICKER_RE.test(plain)) throw new Error(`Invalid ticker: ${plain || "(empty)"}`);
    // Reject overselling at the source: the ledger fold silently caps a SELL at
    // the lots held, so a too-large SELL would otherwise be recorded as bad data
    // with understated realized P&L instead of being rejected.
    if (side === "SELL") {
      const heldLots = posBy.get(normalizeTicker(plain).toUpperCase())?.lots ?? 0;
      if ((Number(lots) || 0) > heldLots) throw new Error(`Cannot sell ${lots} lots — only ${heldLots} held`);
    }
    await insertStockTransaction({
      ticker: normalizeTicker(plain),
      side,
      lots: Number(lots) || 0,
      price: Number(price) || 0,
      fee: Number(fee) || 0,
      txn_at: new Date(date).toISOString(),
      notes,
    });
    setTradeModal(null);
    router.refresh();
  }

  async function insertDividend(
    ticker: string,
    amount: string,
    perShare: string,
    paidAt: string,
    notes: string,
  ) {
    await insertStockDividend({
      ticker: normalizeTicker(ticker),
      amount: Number(amount) || 0,
      per_share: perShare.trim() !== "" ? Number(perShare) : null,
      paid_at: paidAt,
      notes,
    });
    setTradeModal(null);
    router.refresh();
  }

  async function deactivate(ticker: string) {
    await deactivatePosition(normalizeTicker(ticker));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-medium text-tprimary">Portfolio</h1>
          {fresh && <p className="mt-0.5 text-caption text-tdim">synced {fmtAgo(fresh)} · yfinance</p>}
        </div>
        <div className="flex gap-2">
          <SecondaryButton onClick={refetchPrices} disabled={refreshing}>
            <RefreshCw size={14} strokeWidth={1.5} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refetching…" : "Refetch prices"}
          </SecondaryButton>
          <PrimaryButton type="button" onClick={() => setTradeModal({ ticker: "", editable: true, tab: "buy" })}>
            <Plus size={14} strokeWidth={2} />
            Buy
          </PrimaryButton>
        </div>
      </div>

      {refetchStatus && (
        <p role="status" className={`text-sm ${refetchStatus.critical ? "text-critical" : "text-tmuted"}`}>{refetchStatus.text}</p>
      )}

      {positions.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Invested" value={totalInvested > 0 ? fmtIdrCompact(totalInvested) : "N/A"} fullValue={totalInvested > 0 ? fmtIdr(totalInvested) : "N/A"} />
          <MetricCard label="Market Value" value={hasMktValue ? fmtIdrCompact(totalMktValue) : "N/A"} fullValue={hasMktValue ? fmtIdr(totalMktValue) : "N/A"} />
          <MetricCard
            label="Total P&L"
            value={!hasMktValue ? "N/A" : fmtSigned(totalPnl, fmtIdrCompact)}
            fullValue={!hasMktValue ? "N/A" : fmtSigned(totalPnl, fmtIdr)}
            sub={hasMktValue && totalPnlPct != null ? fmtSigned(totalPnlPct) : undefined}
            color={!hasMktValue ? undefined : tone(totalPnl)}
            glyph={!hasMktValue ? undefined : dirGlyph(totalPnl)}
          />
          <MetricCard label="Positions" value={String(positions.length)} />
          <MetricCard
            label="Realized"
            value={fmtSigned(totalRealized, fmtIdrCompact)}
            fullValue={fmtSigned(totalRealized, fmtIdr)}
            color={tone(totalRealized)}
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
            prefill={tradeModal.prefill}
            currentLots={posBy.get(tradeModal.ticker)?.lots ?? 0}
            onClose={() => setTradeModal(null)}
            onBuy={(v) => insertTxn(tradeModal.ticker || v.ticker, "BUY", v.lots, v.price, v.date, v.notes, v.fee)}
            onSell={(v) => insertTxn(tradeModal.ticker, "SELL", v.lots, v.price, v.date, v.notes, v.fee)}
            onDividend={(v) => insertDividend(tradeModal.ticker, v.amount, v.perShare, v.paidAt, v.notes)}
          />
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${displayTicker(removing)}?`}
          message="The position is hidden from the portfolio. Its transactions and dividends stay in the ledger."
          onConfirm={() => deactivate(removing)}
          onClose={() => setRemoving(null)}
        />
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
                      {lots > 0 && <span className="ml-2 text-xs text-tdim">{fmtNum(lots)} lots</span>}
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
                      {pnl != null && <Delta value={pnl} />}
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
                      <Delta value={realized} fmt={fmtIdr} empty="N/A" />
                    </div>
                    <div>
                      <span className="text-tdim">Income </span>
                      <span className="num text-tprimary">{income ? fmtIdr(income) : "N/A"}</span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-edge/50 pt-2 text-xs font-medium">
                    <SecondaryButton size="sm" onClick={() => setTradeModal({ ticker: t, editable: false, tab: "buy" })}>Trade</SecondaryButton>
                    <SecondaryButton size="sm" onClick={() => setRemoving(t)}>Remove</SecondaryButton>
                    <SecondaryButton
                      size="sm"
                      className="ml-auto"
                      aria-expanded={openPeers === t}
                      aria-controls={`peers-m-${t}`}
                      onClick={() => togglePeers(t)}
                    >
                      Peers
                      <ChevronDown size={14} strokeWidth={1.5} aria-hidden className={`transition-transform duration-[120ms] ${openPeers === t ? "rotate-180" : ""}`} />
                    </SecondaryButton>
                  </div>
                  {openPeers === t && (
                    <div id={`peers-m-${t}`} className="mt-2 border-t border-edge/50 pt-2">
                      <PeerPanel valuation={valBy.get(t)} peers={peersBy.get(t) ?? []} snapBy={snapBy} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  {COLUMNS.map((c) =>
                    c.col ? (
                      <SortTh key={c.label} col={c.col} label={c.label} title={c.tip} sort={sort} onSort={toggleSort} className={`${c.pr ?? "pr-4"} ${c.align}`} />
                    ) : (
                      <th key={c.label} title={c.tip} className={`pb-2 ${c.pr ?? "pr-4"} ${c.align}`}>{c.label}</th>
                    ),
                  )}
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
                  const open = openPeers === t;
                  return (
                    <Fragment key={t}>
                    <tr className="border-t border-edge">
                      <td className="py-2 pr-4">
                        <Link href={`/stocks?ticker=${displayTicker(t)}`} className="font-medium text-accent hover:underline">{displayTicker(t)}</Link>
                      </td>
                      <td className="num py-2 pr-4 text-right">{lots ? fmtNum(lots) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">{cur ? fmtIdr(cur) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">
                        <span className="text-tmuted">{avg ? fmtIdr(avg, 2) : "N/A"}</span>{" "}
                        <Delta value={pnl} empty="N/A" />
                      </td>
                      <td className="py-2 pr-4 text-right"><MiniSparkline prices={history[t]} /></td>
                      <td className="num py-2 pr-4 text-right text-tmuted">{invested ? fmtIdr(invested) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">{mktValue ? fmtIdr(mktValue) : "N/A"}</td>
                      <td className="num py-2 pr-4 text-right">
                        <Delta value={realized} fmt={fmtIdr} empty="N/A" />
                      </td>
                      <td className="num py-2 pr-6 text-right text-tmuted">{income ? fmtIdr(income) : "N/A"}</td>
                      <td className="py-2 pr-4"><RecommendationBadge rec={recBy.get(t)} /></td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => togglePeers(t)}
                            aria-expanded={open}
                            aria-controls={`peers-d-${t}`}
                            title="Peer valuation"
                            aria-label={`Peers of ${displayTicker(t)}`}
                            className="rounded p-1 text-tdim hover:bg-component hover:text-tprimary"
                          >
                            <ChevronDown size={15} strokeWidth={1.5} className={`transition-transform duration-[120ms] ${open ? "rotate-180" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setTradeModal({ ticker: t, editable: false, tab: "buy" })}
                            title="Buy / Sell / Dividend"
                            aria-label={`Trade ${displayTicker(t)}`}
                            className="rounded p-1 text-tdim hover:bg-component hover:text-tprimary"
                          >
                            <ArrowLeftRight size={15} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(t)}
                            title="Remove position"
                            aria-label={`Remove ${displayTicker(t)}`}
                            className="rounded p-1 text-tdim hover:bg-component hover:text-tprimary"
                          >
                            <Trash2 size={15} strokeWidth={1.5} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr id={`peers-d-${t}`}>
                        <td colSpan={COLUMNS.length + 1} className="bg-component/40 px-3 pb-4 pt-2">
                          <PeerPanel valuation={valBy.get(t)} peers={peersBy.get(t) ?? []} snapBy={snapBy} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
  prefill,
  currentLots,
  onClose,
  onBuy,
  onSell,
  onDividend,
}: {
  ticker: string;
  editable: boolean;
  initialTab: TradeTab;
  prefill?: string;
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
              type="button"
              aria-pressed={tab === tb.key}
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
        <TxnForm side="BUY" ticker={ticker || prefill || ""} tickerEditable={editable} onCancel={onClose} onSave={onBuy} />
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
  const { busy, error, run } = useAsyncAction();

  function submit() {
    run("save", async () => {
      if (side === "SELL" && currentLots != null && (Number(lots) || 0) > currentLots) {
        throw new Error(`Cannot sell more than ${currentLots} lots held`);
      }
      await onSave({ ticker: tickerVal, lots, price, date, notes, fee });
    });
  }

  return (
    <Form onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Ticker">
          <input
            placeholder="e.g. BBCA"
            value={tickerVal}
            onChange={(e) => setTickerVal(e.target.value.toUpperCase())}
            readOnly={!tickerEditable}
            className={`${inputCls} ${!tickerEditable ? "opacity-70" : ""}`}
          />
        </Field>
        <Field label="Date & Time">
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Lots">
          <input type="number" value={lots} onChange={(e) => setLots(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Price per Share (IDR)">
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Fee (IDR)" optional>
          <input type="number" value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes" optional className="md:col-span-2">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <FormActions busy={busy !== null} error={error} submitLabel={side === "BUY" ? "Buy" : "Sell"} onCancel={onCancel} />
    </Form>
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
  const { busy, error, run } = useAsyncAction();

  return (
    <Form onSubmit={() => run("save", () => onSave({ amount, perShare, paidAt, notes }))}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Amount (IDR)">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Per Share (IDR)" optional>
          <input type="number" value={perShare} onChange={(e) => setPerShare(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Paid Date">
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes" optional className="md:col-span-2">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <FormActions busy={busy !== null} error={error} onCancel={onCancel} />
    </Form>
  );
}
