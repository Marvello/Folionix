"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, Receipt, RefreshCw } from "lucide-react";
import {
  insertPriceRefreshRequest,
  pollLatestFundNavTime,
  insertFundPurchase,
  updateFundPurchase,
  deactivateFundPurchase,
  insertFundDistribution,
} from "@/app/actions";
import { fmtCurrency, fmtIdrCompact, fmtWib, fmtAgo, dirGlyph } from "@/lib/format";
import type { FundPurchase, FundNav, FundCatalogItem, ForexRate, FundDistribution, FundHolding } from "@/lib/types";
import { foldWeightedAvg, type LedgerLot } from "@folionix/lib";
import MetricCard from "@/components/MetricCard";
import EmptyState from "@/components/EmptyState";
import Modal from "@/components/Modal";
import Pager from "@/components/Pager";
import { usePaged } from "@/lib/usePaged";

const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const nowLocalInput = () => toLocalInput(new Date());
const todayInput = () => new Date().toISOString().slice(0, 10);

type FormVals = {
  platform: string;
  units: string;
  buyNav: string;
  total: string;
  currency: string;
  notes: string;
  purchased: string;
};

// Three mutually-derivable fields: units × nav = total. User fills any two;
// the third is recomputed from whichever two were most recently edited.
type AmountField = "units" | "nav" | "total";
type AmountFields = { units: string; nav: string; total: string };

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
    const derived = (["units", "nav", "total"] as const).find((f) => !nextTouched.includes(f));
    const u = parseNum(next.units);
    const n = parseNum(next.nav);
    const t = parseNum(next.total);
    if (derived === "total" && u != null && n != null) {
      next.total = String(round(u * n, 0));
    } else if (derived === "nav" && u != null && t != null && u > 0) {
      next.nav = String(round(t / u, 2));
    } else if (derived === "units" && n != null && t != null && n > 0) {
      next.units = String(round(t / n, 4));
    }
  }
  return { fields: next, touched: nextTouched };
}

type SelectedFund = { code: string; name: string };

type Editing = (FormVals & { id: number; fundCode: string; fundName: string }) | null;

export default function FundsClient({
  purchases,
  navs,
  catalog,
  forexRates,
  knownPlatforms,
  distributions,
  holdings = [],
}: {
  purchases: FundPurchase[];
  navs: FundNav[];
  catalog: FundCatalogItem[];
  forexRates: ForexRate[];
  knownPlatforms: string[];
  distributions: FundDistribution[];
  holdings?: FundHolding[];
}) {
  const router = useRouter();
  const navByCode = new Map(navs.map((n) => [n.fund_code, n.nav]));
  // Full NAV rows (metrics) + composition, keyed by fund code, for the info modal.
  const navRowByCode = new Map(navs.map((n) => [n.fund_code, n]));
  const catByCode = new Map(catalog.map((c) => [c.code, c]));
  const holdingsByCode = new Map<string, FundHolding[]>();
  for (const h of holdings) {
    const rows = holdingsByCode.get(h.fund_code) ?? [];
    rows.push(h);
    holdingsByCode.set(h.fund_code, rows);
  }
  // fxToIdr: rate to convert 1 unit of foreign currency → IDR
  const fxToIdr = new Map(
    forexRates
      .filter((r) => r.quote_currency === "IDR")
      .map((r) => [r.base_currency, r.rate]),
  );
  const fresh = navs.reduce<string | null>(
    (acc, n) => (n.fetched_at && (!acc || n.fetched_at > acc) ? n.fetched_at : acc),
    null,
  );
  // Distribution income is already IDR, summed per fund code.
  const distByCode = new Map<string, number>();
  for (const d of distributions) {
    distByCode.set(d.fund_code, (distByCode.get(d.fund_code) ?? 0) + d.amount);
  }

  const [editing, setEditing] = useState<Editing>(null);
  const [creating, setCreating] = useState(false);
  const [selling, setSelling] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fundSort, setFundSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "cost", dir: "desc" });
  const [refreshing, setRefreshing] = useState(false);
  const [infoCode, setInfoCode] = useState<string | null>(null);

  // Guard the refetch poll against firing after the component unmounts.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function refetchNavs() {
    setRefreshing(true);
    setErr(null);
    const baseline = fresh;
    await insertPriceRefreshRequest("fund");
    const deadline = Date.now() + 30000;
    const tick = async () => {
      if (!alive.current) return;
      const newest = await pollLatestFundNavTime();
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

  function toggleFundSort(col: string) {
    setFundSort((s) => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }));
  }

  // Per-purchase display math. BUY rows keep the usual cost/value/P&L; a SELL
  // row has no "value" of its own (the units are disposed) so we show sale
  // proceeds in the cost slot instead and blank out value/P&L rather than
  // showing a number that would misleadingly imply the sold units are still held.
  const rows = purchases.map((p) => {
    const side = p.side ?? "BUY";
    const currency = p.currency || "IDR";
    const rowAmount = p.units * p.buy_nav_per_unit; // cost (BUY) or proceeds (SELL)
    const nav = navByCode.get(p.fund_code) ?? null;
    const value = side === "BUY" && nav != null ? p.units * nav : null;
    const pnl = side === "BUY" && value != null ? value - rowAmount : null;
    const pnlPct = pnl != null && rowAmount ? (pnl / rowAmount) * 100 : null;
    const fxRate = currency === "IDR" ? 1 : (fxToIdr.get(currency) ?? null);
    const valueIdr = value != null && fxRate != null ? value * fxRate : null;
    return { p, side, currency, rowAmount, value, pnl, pnlPct, fxRate, valueIdr };
  });
  const { page: txnPage, setPage: setTxnPage, totalPages: txnPages, pageItems: txnItems } = usePaged(rows);

  // Per-product aggregation must be folded chronologically per fund (a SELL
  // realizes P&L against the average buy NAV at the time and never changes
  // that average) — summing raw rows would double-count or misprice partial
  // sells. Group by fund code, sort each group ascending, then fold.
  const fundGroups = new Map<string, FundPurchase[]>();
  for (const p of purchases) {
    const arr = fundGroups.get(p.fund_code);
    if (arr) arr.push(p);
    else fundGroups.set(p.fund_code, [p]);
  }

  const allFunds = Array.from(fundGroups.entries())
    .map(([code, group]) => ({ code, name: group[0].fund_name || code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const productRowsAll = Array.from(fundGroups.entries()).map(([code, group]) => {
    const sorted = [...group].sort((a, b) =>
      a.purchased_at === b.purchased_at ? a.id - b.id : a.purchased_at.localeCompare(b.purchased_at),
    );
    const lots: LedgerLot[] = sorted.map((p) => ({
      side: p.side ?? "BUY",
      qty: p.units,
      price: p.buy_nav_per_unit,
      at: p.purchased_at,
    }));
    const f = foldWeightedAvg(lots);
    const last = sorted[sorted.length - 1];
    const currency = last.currency || "IDR";
    const nav = navByCode.get(code) ?? null;
    const value = nav != null ? f.netQty * nav : null;
    const pnl = value != null ? value - f.totalBuyCost : null;
    const pnlPct = pnl != null && f.totalBuyCost ? (pnl / f.totalBuyCost) * 100 : null;
    // IDR equivalent for non-IDR holdings — the exchange rate, shown once per
    // product instead of repeated on every transaction row.
    const fxRate = currency === "IDR" ? 1 : (fxToIdr.get(currency) ?? null);
    const valueIdr = value != null && fxRate != null ? value * fxRate : null;
    const costIdr = fxRate != null ? f.totalBuyCost * fxRate : null;
    const realizedIdr = fxRate != null ? f.realizedPnl * fxRate : null;
    const distIncome = distByCode.get(code) ?? 0;
    return {
      code,
      name: last.fund_name || code,
      currency,
      units: f.netQty,
      cost: f.totalBuyCost,
      avgNav: f.avgBuy,
      realized: f.realizedPnl,
      realizedIdr,
      distIncome,
      platform: last.platform || "",
      nav,
      value,
      pnl,
      pnlPct,
      txCount: group.length,
      fxRate,
      valueIdr,
      costIdr,
    };
  });

  // Fully-closed funds (no net units, no realized P&L, no distribution income)
  // have nothing left to show — drop them from the product table.
  const productRows = productRowsAll
    .filter((r) => Math.abs(r.units) > 1e-6 || Math.abs(r.realized) > 1e-6 || r.distIncome !== 0)
    .sort((a, b) => {
      const dir = fundSort.dir === "asc" ? 1 : -1;
      switch (fundSort.col) {
        case "name":     return dir * a.name.localeCompare(b.name);
        case "units":    return dir * (a.units - b.units);
        case "avgNav":   return dir * (a.avgNav - b.avgNav);
        case "cost":     return dir * (a.cost - b.cost);
        case "value":    return dir * ((a.value ?? -Infinity) - (b.value ?? -Infinity));
        case "pnl":      return dir * ((a.pnl ?? -Infinity) - (b.pnl ?? -Infinity));
        case "realized": return dir * ((a.realizedIdr ?? -Infinity) - (b.realizedIdr ?? -Infinity));
        case "dist":     return dir * (a.distIncome - b.distIncome);
        case "txn":      return dir * (a.txCount - b.txCount);
        default:         return 0;
      }
    });

  // Funds currently held (net units > 0) — the only funds eligible to sell from.
  const heldFunds = productRowsAll
    .filter((r) => r.units > 1e-6)
    .map((r) => ({ code: r.code, name: r.name, currency: r.currency, netUnits: r.units, platform: r.platform }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // All summary cards in IDR, netted per-product (buys − sells). Products
  // without a known FX rate are excluded from totals.
  const productsWithRate = productRowsAll.filter((r) => r.costIdr != null);
  const productsMissingRate = productRowsAll.filter((r) => r.costIdr == null && (Math.abs(r.units) > 1e-6 || Math.abs(r.realized) > 1e-6));
  const totalCostIdr = productsWithRate.reduce((s, r) => s + r.costIdr!, 0);
  const hasValueIdr = productsWithRate.some((r) => r.valueIdr != null);
  const totalValueIdr = productsWithRate.reduce((s, r) => s + (r.valueIdr ?? 0), 0);
  const totalPnlIdr = hasValueIdr ? totalValueIdr - totalCostIdr : null;
  const totalPnlPctIdr = totalPnlIdr != null && totalCostIdr ? (totalPnlIdr / totalCostIdr) * 100 : null;
  const totalRealizedIdr = productsWithRate.reduce((s, r) => s + (r.realizedIdr ?? 0), 0);
  const totalDistIncome = distributions.reduce((s, d) => s + d.amount, 0);
  const holdingsCount = heldFunds.length;

  async function save(v: FormVals & { fund: SelectedFund | null }, id: number | null) {
    const units = Number(v.units);
    const buyNav = Number(v.buyNav);
    if (!Number.isFinite(units) || units <= 0) {
      setErr("Units must be a positive number.");
      throw new Error("invalid units");
    }
    if (!Number.isFinite(buyNav) || buyNav <= 0) {
      setErr("Buy NAV must be a positive number.");
      throw new Error("invalid buy NAV");
    }
    if (id == null) {
      if (!v.fund) return;
      await insertFundPurchase({
        fund_code: v.fund.code,
        fund_name: v.fund.name,
        platform: v.platform,
        currency: v.currency || "IDR",
        units,
        buy_nav_per_unit: buyNav,
        purchased_at: new Date(v.purchased).toISOString(),
        notes: v.notes,
      });
    } else {
      await updateFundPurchase(id, {
        platform: v.platform,
        currency: v.currency || "IDR",
        units,
        buy_nav_per_unit: buyNav,
        notes: v.notes,
        purchased_at: new Date(v.purchased).toISOString(),
      });
    }
    setCreating(false); setEditing(null); setErr(null); router.refresh();
  }

  async function deactivate(id: number) {
    await deactivateFundPurchase(id);
    setEditing(null); router.refresh();
  }

  async function saveSell(v: {
    fund: SelectedFund;
    platform: string;
    currency: string;
    units: string;
    nav: string;
    notes: string;
    soldAt: string;
  }) {
    await insertFundPurchase({
      fund_code: v.fund.code,
      fund_name: v.fund.name,
      platform: v.platform,
      currency: v.currency,
      units: Number(v.units),
      buy_nav_per_unit: Number(v.nav),
      purchased_at: new Date(v.soldAt).toISOString(),
      notes: v.notes,
      side: "SELL",
    });
    setSelling(false); setErr(null); router.refresh();
  }

  async function recordDistribution(v: { fundCode: string; amount: number; paidAt: string; notes: string }) {
    await insertFundDistribution({
      fund_code: v.fundCode,
      amount: v.amount,
      paid_at: v.paidAt,
      notes: v.notes,
    });
    setDistributing(false); setErr(null); router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-tprimary">Mutual Funds</h1>
          {fresh && <p className="mt-0.5 text-[11px] text-tdim">NAV synced {fmtAgo(fresh)} · cermati</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={refetchNavs}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-tmuted hover:text-tprimary disabled:opacity-60"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{refreshing ? "Refetching…" : "Refetch NAVs"}</span>
            <span className="sm:hidden">{refreshing ? "…" : "NAVs"}</span>
          </button>
          {allFunds.length > 0 && (
            <button
              onClick={() => { setDistributing(true); setErr(null); }}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm font-semibold text-tmuted hover:text-tprimary"
            >
              <Receipt size={14} strokeWidth={2} />
              <span className="hidden sm:inline">Record Distribution</span>
              <span className="sm:hidden">Dist.</span>
            </button>
          )}
          {heldFunds.length > 0 && (
            <button
              onClick={() => { setSelling(true); setErr(null); }}
              className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm font-semibold text-tmuted hover:text-tprimary"
            >
              <Minus size={14} strokeWidth={2} />
              Sell
            </button>
          )}
          <button
            onClick={() => { setCreating(true); setErr(null); }}
            className="flex items-center gap-1.5 rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page"
          >
            <Plus size={14} strokeWidth={2} />
            Add
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-critical">{err}</p>}

      {purchases.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Total Cost (IDR)" value={fmtIdrCompact(totalCostIdr)} fullValue={fmtCurrency(totalCostIdr, "IDR")} />
            <MetricCard label="Total Value (IDR)" value={hasValueIdr ? fmtIdrCompact(totalValueIdr) : "N/A"} fullValue={hasValueIdr ? fmtCurrency(totalValueIdr, "IDR") : "N/A"} />
            <MetricCard
              label="Total P&L (IDR)"
              value={totalPnlIdr == null ? "N/A" : `${totalPnlIdr >= 0 ? "+" : ""}${fmtIdrCompact(totalPnlIdr)}`}
              fullValue={totalPnlIdr == null ? "N/A" : `${totalPnlIdr >= 0 ? "+" : ""}${fmtCurrency(totalPnlIdr, "IDR")}`}
              sub={totalPnlPctIdr != null ? `${totalPnlPctIdr >= 0 ? "+" : ""}${totalPnlPctIdr.toFixed(1)}%` : undefined}
              color={totalPnlIdr == null ? undefined : totalPnlIdr >= 0 ? "up" : "down"}
              glyph={totalPnlIdr == null ? undefined : dirGlyph(totalPnlIdr)}
            />
            <MetricCard
              label="Realized (IDR)"
              value={`${totalRealizedIdr >= 0 ? "+" : ""}${fmtIdrCompact(totalRealizedIdr)}`}
              fullValue={`${totalRealizedIdr >= 0 ? "+" : ""}${fmtCurrency(totalRealizedIdr, "IDR")}`}
              color={totalRealizedIdr >= 0 ? "up" : "down"}
              glyph={totalRealizedIdr >= 0 ? "up" : "down"}
            />
            <MetricCard label="Income (IDR)" value={fmtIdrCompact(totalDistIncome)} fullValue={fmtCurrency(totalDistIncome, "IDR")} />
            <MetricCard label="Holdings" value={String(holdingsCount)} />
          </div>
          {productsMissingRate.length > 0 && (
            <p className="text-[11px] text-tdim">
              {productsMissingRate.length} holding{productsMissingRate.length > 1 ? "s" : ""} excluded from totals — FX rate unavailable (run NAV refresh to fetch rates)
            </p>
          )}
        </div>
      )}

      {creating && (
        <Modal title="Add Fund" onClose={() => setCreating(false)}>
          <FundForm
            catalog={catalog}
            knownPlatforms={knownPlatforms}
            onCancel={() => setCreating(false)}
            onSave={(v) => save(v, null)}
          />
        </Modal>
      )}

      {selling && (
        <Modal title="Sell Fund" onClose={() => setSelling(false)}>
          <FundSellForm
            heldFunds={heldFunds}
            knownPlatforms={knownPlatforms}
            onCancel={() => setSelling(false)}
            onSave={saveSell}
          />
        </Modal>
      )}

      {distributing && (
        <Modal title="Record Distribution" onClose={() => setDistributing(false)}>
          <FundDistributionForm
            funds={allFunds}
            onCancel={() => setDistributing(false)}
            onSave={recordDistribution}
          />
        </Modal>
      )}

      {purchases.length === 0 ? (
        <EmptyState message="No active fund holdings." />
      ) : (
        <>
          {/* ── By Product summary ── */}
          <p className="text-xs font-semibold text-tdim">BY PRODUCT</p>

          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  {(["name","units","avgNav","cost","value","pnl","realized","dist","txn"] as const).map((col, i) => {
                    const labels: Record<string, string> = { name:"FUND", units:"TOTAL UNITS", avgNav:"AVG BUY NAV", cost:"TOTAL COST", value:"CURRENT VALUE", pnl:"P&L", realized:"REALIZED (IDR)", dist:"INCOME (IDR)", txn:"TXN" };
                    const active = fundSort.col === col;
                    return (
                      <th key={col} onClick={() => toggleFundSort(col)}
                        className={`cursor-pointer select-none pb-2 pr-4 ${i === 0 ? "text-left" : "text-right"} hover:text-tprimary ${active ? "text-tprimary" : ""}`}>
                        {labels[col]}{active ? (fundSort.dir === "desc" ? " ↓" : " ↑") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {productRows.map((r) => (
                  <tr key={r.code} className="border-t border-edge">
                    <td className="py-2 pr-4 font-medium text-tprimary">
                      <button type="button" onClick={() => setInfoCode(r.code)} className="text-left hover:text-ai hover:underline">
                        {r.name}
                      </button>
                      {r.currency !== "IDR" && <span className="ml-1.5 rounded bg-edge px-1 py-0.5 text-[10px] text-tdim">{r.currency}</span>}
                      <span className="block text-xs text-tdim">{r.code}</span>
                    </td>
                    <td className="num py-2 pr-4 text-right">{r.units.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="num py-2 pr-4 text-right text-tmuted">{fmtCurrency(r.avgNav, r.currency, 2)}</td>
                    <td className="num py-2 pr-4 text-right text-tmuted">
                      {fmtCurrency(r.cost, r.currency)}
                      {r.costIdr != null && r.currency !== "IDR" && <span className="block text-[10px] text-tdim">≈ {fmtCurrency(r.costIdr, "IDR")}</span>}
                    </td>
                    <td className="num py-2 pr-4 text-right">
                      {r.value != null ? fmtCurrency(r.value, r.currency) : "—"}
                      {r.valueIdr != null && r.currency !== "IDR" && <span className="block text-[10px] text-tdim">≈ {fmtCurrency(r.valueIdr, "IDR")}</span>}
                    </td>
                    <td className="num whitespace-nowrap py-2 pr-4 text-right">
                      <span className={r.pnl == null ? "text-tdim" : r.pnl >= 0 ? "text-up" : "text-down"}>
                        {r.pnl == null ? "—" : `${dirGlyph(r.pnl)} ${r.pnl >= 0 ? "+" : ""}${fmtCurrency(r.pnl, r.currency)}`}
                      </span>
                      {r.pnlPct != null && (
                        <span className={`ml-1 text-xs ${r.pnlPct >= 0 ? "text-up" : "text-down"}`}>
                          ({`${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}%`})
                        </span>
                      )}
                    </td>
                    <td className="num py-2 pr-4 text-right">
                      {r.realizedIdr != null
                        ? <span className={r.realizedIdr >= 0 ? "text-up" : "text-down"}>{`${r.realizedIdr >= 0 ? "+" : ""}${fmtCurrency(r.realizedIdr, "IDR")}`}</span>
                        : <span className="text-tdim">—</span>}
                    </td>
                    <td className="num py-2 pr-4 text-right text-tmuted">{r.distIncome !== 0 ? fmtCurrency(r.distIncome, "IDR") : "—"}</td>
                    <td className="num py-2 text-right text-tdim">{r.txCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <div className="space-y-2 md:hidden">
            {productRows.map((r) => (
              <div key={r.code} className="rounded-lg border border-edge bg-component p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button type="button" onClick={() => setInfoCode(r.code)} className="truncate text-left font-medium text-tprimary hover:text-ai hover:underline">{r.name}</button>
                    <div className="text-xs text-tdim">{r.code} · {r.txCount} txn</div>
                  </div>
                  {r.pnlPct != null && (
                    <span className={`shrink-0 text-xs font-medium ${r.pnlPct >= 0 ? "text-up" : "text-down"}`}>
                      {`${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}%`}
                    </span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-tdim">Units </span><span className="num text-tprimary">{r.units.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span></div>
                  <div><span className="text-tdim">Avg NAV </span><span className="num text-tprimary">{fmtCurrency(r.avgNav, r.currency, 2)}</span></div>
                  <div>
                    <span className="text-tdim">Cost </span><span className="num text-tprimary">{fmtCurrency(r.cost, r.currency)}</span>
                    {r.costIdr != null && r.currency !== "IDR" && <span className="block text-[10px] text-tdim">≈ {fmtCurrency(r.costIdr, "IDR")}</span>}
                  </div>
                  <div>
                    <span className="text-tdim">Value </span><span className="num text-tprimary">{r.value != null ? fmtCurrency(r.value, r.currency) : "—"}</span>
                    {r.valueIdr != null && r.currency !== "IDR" && <span className="block text-[10px] text-tdim">≈ {fmtCurrency(r.valueIdr, "IDR")}</span>}
                  </div>
                  {r.pnl != null && (
                    <div className="col-span-2">
                      <span className="text-tdim">P&amp;L </span>
                      <span className={`num ${r.pnl >= 0 ? "text-up" : "text-down"}`}>
                        {`${dirGlyph(r.pnl)} ${r.pnl >= 0 ? "+" : ""}${fmtCurrency(r.pnl, r.currency)}`}
                      </span>
                    </div>
                  )}
                  {(r.realizedIdr != null || r.distIncome !== 0) && (
                    <div className="col-span-2 flex gap-4">
                      {r.realizedIdr != null && (
                        <span><span className="text-tdim">Realized </span><span className={`num ${r.realizedIdr >= 0 ? "text-up" : "text-down"}`}>{`${r.realizedIdr >= 0 ? "+" : ""}${fmtCurrency(r.realizedIdr, "IDR")}`}</span></span>
                      )}
                      {r.distIncome !== 0 && (
                        <span><span className="text-tdim">Income </span><span className="num text-tprimary">{fmtCurrency(r.distIncome, "IDR")}</span></span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Transactions ── */}
          <p className="text-xs font-semibold text-tdim">TRANSACTIONS</p>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {txnItems.map(({ p, side, currency, rowAmount, value, pnl, pnlPct }) => (
              <div key={p.id} className="rounded-lg border border-edge bg-component p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-tprimary">{p.fund_name || p.fund_code}</span>
                      {side === "SELL" && (
                        <span className="shrink-0 rounded-full border border-down/30 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-down">
                          Sell
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-tdim">{p.fund_code}{p.platform ? ` · ${p.platform}` : ""}{currency !== "IDR" ? ` · ${currency}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {pnlPct != null && (
                      <span className={`text-xs font-medium ${pnlPct >= 0 ? "text-up" : "text-down"}`}>
                        {`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`}
                      </span>
                    )}
                    <button
                      onClick={() => setEditing({
                        id: p.id,
                        fundCode: p.fund_code,
                        fundName: p.fund_name || p.fund_code,
                        platform: p.platform ?? "",
                        currency: p.currency || "IDR",
                        units: String(p.units),
                        buyNav: String(p.buy_nav_per_unit),
                        total: String((p.currency || "IDR") === "IDR" ? Math.round(p.units * p.buy_nav_per_unit) : +(p.units * p.buy_nav_per_unit).toFixed(2)),
                        notes: p.notes ?? "",
                        purchased: toLocalInput(new Date(p.purchased_at)),
                      })}
                      className="text-xs text-tdim hover:text-tprimary"
                    >Edit</button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-tdim">Units </span><span className="num text-tprimary">{p.units.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span></div>
                  <div><span className="text-tdim">{side === "SELL" ? "Sell NAV " : "Buy NAV "}</span><span className="num text-tprimary">{fmtCurrency(p.buy_nav_per_unit, currency, 2)}</span></div>
                  <div><span className="text-tdim">{side === "SELL" ? "Proceeds " : "Cost "}</span><span className="num text-tprimary">{fmtCurrency(rowAmount, currency)}</span></div>
                  <div><span className="text-tdim">Value </span><span className="num text-tprimary">{value != null ? fmtCurrency(value, currency) : "—"}</span></div>
                  {side === "BUY" && (
                    <div className="col-span-2">
                      <span className="text-tdim">P&amp;L </span>
                      <span className={pnl == null ? "num text-tdim" : `num ${pnl! >= 0 ? "text-up" : "text-down"}`}>
                        {pnl == null ? "—" : `${dirGlyph(pnl)} ${pnl >= 0 ? "+" : ""}${fmtCurrency(pnl, currency)}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4 text-left">FUND</th>
                  <th className="pb-2 pr-4 text-left">PLATFORM</th>
                  <th className="pb-2 pr-4 text-right">UNITS</th>
                  <th className="pb-2 pr-4 text-right">NAV</th>
                  <th className="pb-2 pr-4 text-right">COST / PROCEEDS</th>
                  <th className="pb-2 pr-4 text-right">VALUE</th>
                  <th className="pb-2 pr-4 text-right">P&amp;L</th>
                  <th className="pb-2 pl-6 pr-4 text-left">PURCHASED</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {txnItems.map(({ p, side, currency, rowAmount, value, pnl, pnlPct }) => (
                  <tr key={p.id} className="border-t border-edge">
                    <td className="py-2 pr-4 font-medium text-tprimary">
                      {p.fund_name || p.fund_code}
                      {currency !== "IDR" && <span className="ml-1.5 rounded bg-edge px-1 py-0.5 text-[10px] text-tdim">{currency}</span>}
                      {side === "SELL" && (
                        <span className="ml-2 rounded-full border border-down/30 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-down">
                          Sell
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-tmuted">{p.platform || "—"}</td>
                    <td className="num py-2 pr-4 text-right">{p.units.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="num py-2 pr-4 text-right">{fmtCurrency(p.buy_nav_per_unit, currency, 2)}</td>
                    <td className="num py-2 pr-4 text-right text-tmuted">{fmtCurrency(rowAmount, currency)}</td>
                    <td className="num py-2 pr-4 text-right">{value != null ? fmtCurrency(value, currency) : "—"}</td>
                    <td className="num whitespace-nowrap py-2 pr-4 text-right">
                      <span className={pnl == null ? "text-tdim" : pnl >= 0 ? "text-up" : "text-down"}>
                        {pnl == null ? "—" : `${dirGlyph(pnl)} ${pnl >= 0 ? "+" : ""}${fmtCurrency(pnl, currency)}`}
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
                          fundCode: p.fund_code,
                          fundName: p.fund_name || p.fund_code,
                          platform: p.platform ?? "",
                          currency,
                          units: String(p.units),
                          buyNav: String(p.buy_nav_per_unit),
                          total: String(currency === "IDR" ? Math.round(p.units * p.buy_nav_per_unit) : +(p.units * p.buy_nav_per_unit).toFixed(2)),
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
          <Pager page={txnPage} totalPages={txnPages} onPrev={() => setTxnPage(txnPage - 1)} onNext={() => setTxnPage(txnPage + 1)} />
        </>
      )}

      {editing && (
        <Modal title="Edit Fund" onClose={() => setEditing(null)}>
          <FundForm
            catalog={catalog}
            knownPlatforms={knownPlatforms}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={(v) => save(v, editing.id)}
            onDeactivate={() => deactivate(editing.id)}
          />
        </Modal>
      )}

      {infoCode && (() => {
        const nav = navRowByCode.get(infoCode);
        const cat = catByCode.get(infoCode);
        const rows = holdingsByCode.get(infoCode) ?? [];
        const cur = cat?.currency || nav?.currency || "IDR";
        const pct = (v: number | null | undefined) =>
          v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
        const items: Array<[string, string]> = [
          ["Manager", cat?.investment_manager || "—"],
          ["Type", cat?.fund_type || "—"],
          ["Category", cat?.category === "SYARIAH" ? "Syariah" : cat?.category ? "Konvensional" : "—"],
          ["Currency", cur],
          ["AUM", nav?.aum != null ? fmtCurrency(nav.aum, cur) : "—"],
          ["Expense ratio", nav?.expense_ratio != null ? `${nav.expense_ratio.toFixed(2)}%` : "—"],
          ["CAGR", pct(nav?.cagr)],
          ["Return 1M", pct(nav?.ret_1m)],
          ["Return 3M", pct(nav?.ret_3m)],
          ["Return YtD", pct(nav?.ret_ytd)],
          ["Return 1Y", pct(nav?.ret_1y)],
        ];
        return (
          <Modal title={cat?.name || infoCode} onClose={() => setInfoCode(null)}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {items.map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[11px] uppercase tracking-wide text-tdim">{label}</div>
                    <div className="text-tprimary">{value}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-tprimary">Portfolio composition</span>
                  {rows[0]?.as_of && <span className="text-[11px] text-tdim">as of {rows[0].as_of}</span>}
                </div>
                {rows.length === 0 ? (
                  <EmptyState message="No composition data yet — synced on the next fund refresh." />
                ) : (
                  <ul className="divide-y divide-edge rounded-md border border-edge">
                    {rows.map((h) => (
                      <li key={`${h.label}-${h.as_of}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate text-tprimary">
                          {h.label}
                          {h.ticker && <span className="ml-1.5 text-xs text-tdim">{h.ticker}</span>}
                        </span>
                        <span className="num shrink-0 text-tmuted">{h.percentage != null ? `${h.percentage.toFixed(2)}%` : "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function FundForm({
  catalog,
  knownPlatforms,
  initial,
  onCancel,
  onSave,
  onDeactivate,
}: {
  catalog: FundCatalogItem[];
  knownPlatforms: string[];
  initial?: FormVals & { id: number; fundCode: string; fundName: string };
  onCancel: () => void;
  onSave: (v: FormVals & { fund: SelectedFund | null }) => Promise<void>;
  onDeactivate?: () => Promise<void>;
}) {
  const isEdit = !!initial;
  const [query, setQuery] = useState("");
  const [fund, setFund] = useState<SelectedFund | null>(
    initial ? { code: initial.fundCode, name: initial.fundName } : null,
  );
  const [currency, setCurrency] = useState(initial?.currency ?? "IDR");
  const [platform, setPlatform] = useState(initial?.platform ?? "");
  const [fields, setFields] = useState<AmountFields>({
    units: initial?.units ?? "",
    nav: initial?.buyNav ?? "",
    total: initial?.total ?? "",
  });
  const [touched, setTouched] = useState<AmountField[]>(initial ? ["units", "nav"] : []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [purchased, setPurchased] = useState(initial?.purchased ?? nowLocalInput());
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  function setAmount(field: AmountField, raw: string) {
    const next = deriveAmountFields(field, raw, fields, touched);
    setFields(next.fields);
    setTouched(next.touched);
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, catalog]);

  const unitsNum = parseNum(fields.units);
  const navNum = parseNum(fields.nav);
  const canSave = !!fund && unitsNum != null && unitsNum > 0 && navNum != null && navNum > 0;

  async function run(kind: "save" | "remove", fn: () => Promise<void>) {
    setBusy(kind);
    try { await fn(); } catch { setBusy(null); }
  }

  return (
    <div>
      <div className="grid gap-3">
        {isEdit ? (
          <div className="rounded-md border border-edge bg-page px-3 py-2">
            <div className="text-tprimary">{fund!.name}</div>
            <div className="text-xs text-tdim">{fund!.code}</div>
          </div>
        ) : fund ? (
          <div className="flex items-center justify-between rounded-md border border-edge bg-page px-3 py-2">
            <div>
              <div className="text-tprimary">{fund.name}</div>
              <div className="text-xs text-tdim">{fund.code}</div>
            </div>
            <button onClick={() => { setFund(null); setQuery(""); }} className="text-xs text-tdim hover:text-tprimary">
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              autoFocus
              placeholder="Search fund by name or code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-edge bg-component shadow-lg">
                {matches.map((c) => (
                  <li key={c.code}>
                    <button
                      onClick={() => {
                        setFund({ code: c.code, name: c.name });
                        setCurrency(c.currency || "IDR");
                        setQuery("");
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-tprimary hover:bg-edge"
                    >
                      <span className="block">{c.name}</span>
                      <span className="block text-xs text-tdim">{c.code} · {c.fund_type ?? ""} · {c.currency}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Platform</span>
            <input
              list="fund-platform-suggestions"
              placeholder="e.g. Bibit, Bareksa"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
            {knownPlatforms.length > 0 && (
              <datalist id="fund-platform-suggestions">
                {knownPlatforms.map((p) => <option key={p} value={p} />)}
              </datalist>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Purchase Date &amp; Time</span>
            <input
              type="datetime-local"
              value={purchased}
              onChange={(e) => setPurchased(e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Units</span>
            <input
              type="number"
              placeholder="e.g. 12345.6789"
              value={fields.units}
              onChange={(e) => setAmount("units", e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Buy NAV per Unit ({currency})</span>
            <input
              type="number"
              placeholder={currency === "IDR" ? "e.g. 1500.50" : "e.g. 1.23"}
              value={fields.nav}
              onChange={(e) => setAmount("nav", e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tdim">Total Amount ({currency})</span>
            <input
              type="number"
              placeholder={currency === "IDR" ? "e.g. 5000000" : "e.g. 1000.00"}
              value={fields.total}
              onChange={(e) => setAmount("total", e.target.value)}
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
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => run("save", () => onSave({
            platform, currency, units: fields.units, buyNav: fields.nav, total: fields.total, notes, purchased, fund,
          }))}
          disabled={!canSave || busy !== null}
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

type HeldFund = { code: string; name: string; currency: string; netUnits: number; platform: string };

function FundSellForm({
  heldFunds,
  knownPlatforms,
  onCancel,
  onSave,
}: {
  heldFunds: HeldFund[];
  knownPlatforms: string[];
  onCancel: () => void;
  onSave: (v: {
    fund: SelectedFund;
    platform: string;
    currency: string;
    units: string;
    nav: string;
    notes: string;
    soldAt: string;
  }) => Promise<void>;
}) {
  const [selectedCode, setSelectedCode] = useState(heldFunds[0]?.code ?? "");
  const selected = heldFunds.find((f) => f.code === selectedCode) ?? null;
  const [platform, setPlatform] = useState(selected?.platform ?? "");
  const [fields, setFields] = useState<AmountFields>({ units: "", nav: "", total: "" });
  const [touched, setTouched] = useState<AmountField[]>([]);
  const [notes, setNotes] = useState("");
  const [soldAt, setSoldAt] = useState(nowLocalInput());
  const [busy, setBusy] = useState(false);

  function selectFund(code: string) {
    setSelectedCode(code);
    const f = heldFunds.find((h) => h.code === code) ?? null;
    setPlatform(f?.platform ?? "");
    setFields({ units: "", nav: "", total: "" });
    setTouched([]);
  }

  function setAmount(field: AmountField, raw: string) {
    const next = deriveAmountFields(field, raw, fields, touched);
    setFields(next.fields);
    setTouched(next.touched);
  }

  const unitsNum = parseNum(fields.units);
  const navNum = parseNum(fields.nav);
  const overSell = selected != null && unitsNum != null && unitsNum > selected.netUnits + 1e-9;
  const canSave = !!selected && unitsNum != null && unitsNum > 0 && navNum != null && navNum > 0 && !overSell;

  async function run() {
    if (!selected) return;
    setBusy(true);
    try {
      await onSave({
        fund: { code: selected.code, name: selected.name },
        platform,
        currency: selected.currency,
        units: fields.units,
        nav: fields.nav,
        notes,
        soldAt,
      });
    } catch {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-tdim">Fund</span>
          <select
            value={selectedCode}
            onChange={(e) => selectFund(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          >
            {heldFunds.length === 0 && <option value="">No holdings available</option>}
            {heldFunds.map((f) => (
              <option key={f.code} value={f.code}>{f.name} ({f.code})</option>
            ))}
          </select>
          {selected && (
            <span className="text-[11px] text-tdim">
              Held: {selected.netUnits.toLocaleString("en-US", { maximumFractionDigits: 4 })} units
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Platform</span>
          <input
            list="fund-platform-suggestions"
            placeholder="e.g. Bibit, Bareksa"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
          {knownPlatforms.length > 0 && (
            <datalist id="fund-platform-suggestions">
              {knownPlatforms.map((p) => <option key={p} value={p} />)}
            </datalist>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Sell Date &amp; Time</span>
          <input
            type="datetime-local"
            value={soldAt}
            onChange={(e) => setSoldAt(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Units to Sell</span>
          <input
            type="number"
            placeholder="e.g. 1000.0000"
            value={fields.units}
            onChange={(e) => setAmount("units", e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Sell NAV per Unit ({selected?.currency ?? "IDR"})</span>
          <input
            type="number"
            placeholder={(selected?.currency ?? "IDR") === "IDR" ? "e.g. 1500.50" : "e.g. 1.23"}
            value={fields.nav}
            onChange={(e) => setAmount("nav", e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Total Proceeds ({selected?.currency ?? "IDR"})</span>
          <input
            type="number"
            value={fields.total}
            onChange={(e) => setAmount("total", e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-tdim">Notes <span className="text-tdim opacity-60">optional</span></span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
      </div>
      {overSell && selected && (
        <p className="mt-2 text-xs text-critical">
          Cannot sell more than the {selected.netUnits.toLocaleString("en-US", { maximumFractionDigits: 4 })} units currently held.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={run}
          disabled={!canSave || busy}
          className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Sell"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">
          Cancel
        </button>
      </div>
    </div>
  );
}

function FundDistributionForm({
  funds,
  onCancel,
  onSave,
}: {
  funds: { code: string; name: string }[];
  onCancel: () => void;
  onSave: (v: { fundCode: string; amount: number; paidAt: string; notes: string }) => Promise<void>;
}) {
  const [fundCode, setFundCode] = useState(funds[0]?.code ?? "");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const canSave = !!fundCode && amountNum > 0 && !!paidAt;

  async function run() {
    setBusy(true);
    try {
      await onSave({ fundCode, amount: amountNum, paidAt, notes });
    } catch {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-tdim">Fund</span>
          <select
            value={fundCode}
            onChange={(e) => setFundCode(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          >
            {funds.length === 0 && <option value="">No funds available</option>}
            {funds.map((f) => (
              <option key={f.code} value={f.code}>{f.name} ({f.code})</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Amount Received (IDR)</span>
          <input
            autoFocus
            type="number"
            placeholder="e.g. 125000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Payment Date</span>
          <input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
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
          onClick={run}
          disabled={!canSave || busy}
          className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Record"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">
          Cancel
        </button>
      </div>
    </div>
  );
}
