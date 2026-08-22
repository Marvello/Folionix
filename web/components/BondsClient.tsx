"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveBondHolding, deactivateBondHolding, insertBondCouponPayments } from "@/app/actions";
import { fmtIdr, fmtIdrCompact, fmtWibDate, fmtAgo } from "@/lib/format";
import { estimateCouponNet, inferPaymentsPerYear, latestPaymentByHolding } from "@folionix/lib";
import type { BondHolding, BondCouponPayment, BondCouponSchedule } from "@/lib/types";
import MetricCard from "@/components/MetricCard";
import EmptyState from "@/components/EmptyState";
import Modal from "@/components/Modal";

const SERIES_TYPES = ["SR", "ORI", "SBR", "ST", "CORP"] as const;
type SeriesType = (typeof SERIES_TYPES)[number];

const todayInput = () => new Date().toISOString().slice(0, 10);

function daysToMaturity(d: string | null): number | null {
  if (!d) return null;
  const ms = new Date(d + "T00:00:00").getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function fmtDuration(days: number): string {
  const yr = Math.floor(days / 365);
  const mo = Math.floor((days % 365) / 30);
  const d = days % 30;
  const parts: string[] = [];
  if (yr > 0) parts.push(`${yr}yr`);
  if (mo > 0) parts.push(`${mo}mo`);
  if (d > 0 || parts.length === 0) parts.push(`${d}d`);
  return parts.slice(0, 2).join(" ");
}

function maturityClass(days: number | null): string {
  if (days == null) return "text-tdim";
  if (days < 0) return "text-down";
  if (days <= 90) return "text-tmuted";
  return "text-up";
}

type FormVals = {
  seriesType: SeriesType;
  seriesCode: string;
  platform: string;
  principal: string;
  purchasePrice: string;
  coupon: string;
  maturity: string;
  notes: string;
  purchased: string;
};

type PaymentForm = { bondId: number; seriesCode: string };

export default function BondsClient({
  holdings,
  payments,
  schedules,
}: {
  holdings: BondHolding[];
  payments: BondCouponPayment[];
  schedules: BondCouponSchedule[];
}) {
  const router = useRouter();

  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [schedLogDate, setSchedLogDate] = useState<string | null>(null);
  const [schedulePage, setSchedulePage] = useState(1);
  const [bulkPayFor, setBulkPayFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [bondSort, setBondSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "total_principal", dir: "desc" });

  function toggleBondSort(col: string) {
    setBondSort((s) => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }));
  }
  const [editing, setEditing] = useState<(FormVals & { id: number }) | null>(null);
  const [loggingPayment, setLoggingPayment] = useState<PaymentForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const currentYear = String(new Date().getFullYear());
  const [yearFilter, setYearFilter] = useState(currentYear);

  // Current year + two previous, newest first
  const payYears = [0, 1, 2].map((n) => String(Number(currentYear) - n));

  // Received amounts below are scoped to the selected year; schedule modal
  // paid-status intentionally stays all-time (uses `payments` directly).
  const visiblePayments = payments.filter((p) => p.paid_at.startsWith(yearFilter));

  // Group payments by bond_holding_id
  const paysByHolding = new Map<number, BondCouponPayment[]>();
  for (const p of visiblePayments) {
    const list = paysByHolding.get(p.bond_holding_id) ?? [];
    list.push(p);
    paysByHolding.set(p.bond_holding_id, list);
  }

  // All-time (year-filter-independent) map of which series have any logged
  // payment — drives the Schedule button for series with no KSEI schedule.
  const holdingSeries = new Map(holdings.map((h) => [h.id, h.series_code]));
  const seriesWithPayments = new Set(
    payments.map((p) => holdingSeries.get(p.bond_holding_id)).filter(Boolean) as string[],
  );

  // Per-holding computed values
  const rows = holdings.map((b) => {
    const holdingPayments = paysByHolding.get(b.id) ?? [];
    const totalReceived = holdingPayments.reduce((s, p) => s + p.amount, 0);
    // payments are ordered newest-first from the server
    const lastPaidAt = holdingPayments[0]?.paid_at ?? null;
    const capitalGain = b.purchase_price != null ? b.principal - b.purchase_price : null;
    const annualIncome = b.coupon_rate != null ? b.principal * (b.coupon_rate / 100) : null;
    return { b, holdingPayments, totalReceived, lastPaidAt, capitalGain, annualIncome };
  });

  // Per-product (series_code) aggregation
  const seriesMap = new Map<string, {
    series_type: string; total_principal: number; total_purchase_cost: number | null;
    coupon_sum: number; coupon_weight: number; annual_income: number;
    maturity_date: string | null; total_received: number; txCount: number;
  }>();
  for (const { b, totalReceived: rcvd } of rows) {
    const prev = seriesMap.get(b.series_code) ?? {
      series_type: b.series_type, total_principal: 0, total_purchase_cost: null,
      coupon_sum: 0, coupon_weight: 0, annual_income: 0,
      maturity_date: b.maturity_date, total_received: 0, txCount: 0,
    };
    seriesMap.set(b.series_code, {
      series_type: prev.series_type,
      total_principal: prev.total_principal + b.principal,
      total_purchase_cost: b.purchase_price != null
        ? (prev.total_purchase_cost ?? 0) + b.purchase_price
        : prev.total_purchase_cost,
      coupon_sum: prev.coupon_sum + (b.coupon_rate != null ? b.coupon_rate * b.principal : 0),
      coupon_weight: prev.coupon_weight + (b.coupon_rate != null ? b.principal : 0),
      annual_income: prev.annual_income + (b.coupon_rate != null ? b.principal * (b.coupon_rate / 100) : 0),
      maturity_date: (!prev.maturity_date || (b.maturity_date && b.maturity_date > prev.maturity_date))
        ? b.maturity_date
        : prev.maturity_date,
      total_received: prev.total_received + rcvd,
      txCount: prev.txCount + 1,
    });
  }
  const productRows = Array.from(seriesMap.entries()).map(([code, agg]) => ({
    code,
    ...agg,
    avg_coupon: agg.coupon_weight > 0 ? agg.coupon_sum / agg.coupon_weight : null,
  })).sort((a, b) => {
    const dir = bondSort.dir === "asc" ? 1 : -1;
    switch (bondSort.col) {
      case "series":          return dir * a.code.localeCompare(b.code);
      case "total_principal": return dir * (a.total_principal - b.total_principal);
      case "avg_coupon":      return dir * ((a.avg_coupon ?? -Infinity) - (b.avg_coupon ?? -Infinity));
      case "annual_income":   return dir * (a.annual_income - b.annual_income);
      case "total_received":  return dir * (a.total_received - b.total_received);
      case "maturity":        return dir * ((a.maturity_date ?? "").localeCompare(b.maturity_date ?? ""));
      case "txn":             return dir * (a.txCount - b.txCount);
      default:                return 0;
    }
  });

  // Summary MetricCard totals
  const totalPrincipal = rows.reduce((s, r) => s + (r.b.principal || 0), 0);
  const totalReceived = rows.reduce((s, r) => s + r.totalReceived, 0);
  const totalAnnualIncome = rows.reduce((s, r) => s + (r.annualIncome ?? 0), 0);

  const couponBase = holdings.filter((b) => b.coupon_rate != null);
  const avgCoupon =
    couponBase.length && totalPrincipal
      ? couponBase.reduce((s, b) => s + (b.coupon_rate! * b.principal), 0) /
        couponBase.reduce((s, b) => s + b.principal, 0)
      : null;

  async function save(vals: FormVals, id: number | null) {
    const principal = Number(vals.principal);
    const purchasePrice = vals.purchasePrice === "" ? null : Number(vals.purchasePrice);
    const coupon = vals.coupon === "" ? null : Number(vals.coupon);
    if (!Number.isFinite(principal) || principal <= 0) {
      setErr("Principal must be a positive number.");
      throw new Error("invalid principal");
    }
    if (purchasePrice != null && (!Number.isFinite(purchasePrice) || purchasePrice <= 0)) {
      setErr("Purchase price must be a positive number.");
      throw new Error("invalid purchase price");
    }
    if (coupon != null && (!Number.isFinite(coupon) || coupon < 0)) {
      setErr("Coupon rate must be zero or positive.");
      throw new Error("invalid coupon rate");
    }
    try {
      await saveBondHolding(id, {
        series_type: vals.seriesType,
        series_code: vals.seriesCode.trim(),
        platform: vals.platform,
        principal,
        purchase_price: purchasePrice,
        coupon_rate: coupon,
        maturity_date: vals.maturity || null,
        purchased_at: new Date(vals.purchased + "T00:00:00").toISOString(),
        notes: vals.notes,
      });
    } catch (e) { setErr(String(e)); throw e; }
    setCreating(false); setEditing(null); setErr(null); router.refresh();
  }

  async function deactivate(id: number) {
    try { await deactivateBondHolding(id); } catch (e) { setErr(String(e)); throw e; }
    setEditing(null); router.refresh();
  }

  async function savePayment(bondId: number, amount: number, paidAt: string, notes: string) {
    try {
      await insertBondCouponPayments([{ bond_holding_id: bondId, amount, paid_at: paidAt, notes }]);
    } catch (e) { setErr(String(e)); throw e; }
    setLoggingPayment(null); setErr(null); router.refresh();
  }

  async function saveBulkPayment(seriesCode: string, totalAmount: number, paidAt: string, notes: string) {
    // Only holdings already purchased by the distribution date are entitled to the coupon —
    // secondary-market buys made after paidAt weren't held on the record date.
    const seriesHoldings = holdings.filter((h) => h.series_code === seriesCode && h.active && h.purchased_at <= paidAt);
    const totalPrincipal = seriesHoldings.reduce((s, h) => s + h.principal, 0);
    if (!totalPrincipal) return;
    const rows = seriesHoldings.map((h) => ({
      bond_holding_id: h.id,
      amount: Math.round((h.principal / totalPrincipal) * totalAmount),
      paid_at: paidAt,
      notes,
    }));
    try { await insertBondCouponPayments(rows); } catch (e) { setErr(String(e)); throw e; }
    setBulkPayFor(null); setErr(null); router.refresh();
  }

  // Log a coupon straight from the schedule: explicit per-holding amounts, date
  // locked to the distribution date. Keeps the schedule modal open afterward.
  async function saveSchedulePayment(
    paidAt: string,
    perHolding: { bondId: number; amount: number }[],
    notes: string,
  ) {
    const rows = perHolding
      .filter((r) => r.amount > 0)
      .map((r) => ({
        bond_holding_id: r.bondId,
        amount: r.amount,
        paid_at: paidAt,
        notes,
      }));
    if (!rows.length) return;
    try { await insertBondCouponPayments(rows); } catch (e) { setErr(String(e)); throw e; }
    setSchedLogDate(null); setErr(null); router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium text-tprimary">Bonds</h1>
        <button
          onClick={() => { setCreating(true); setErr(null); }}
          className="flex items-center gap-1.5 rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page"
        >
          <Plus size={14} strokeWidth={2} />
          Add Bond
        </button>
      </div>

      {err && <p className="text-sm text-critical">{err}</p>}

      {holdings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="mr-1 text-tdim">Received in</span>
            {payYears.map((y) => (
              <button
                key={y}
                onClick={() => setYearFilter(y)}
                className={`rounded-md border px-2.5 py-1 ${
                  yearFilter === y
                    ? "border-btn bg-btn font-semibold text-page"
                    : "border-edge text-tmuted hover:text-tprimary"
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Total Principal" value={fmtIdrCompact(totalPrincipal)} fullValue={fmtIdr(totalPrincipal)} />
            <MetricCard
              label={`Received (${yearFilter})`}
              value={totalReceived > 0 ? fmtIdrCompact(totalReceived) : "IDR 0"}
              fullValue={totalReceived > 0 ? fmtIdr(totalReceived) : "IDR 0"}
            />
            <MetricCard
              label="Annual Income"
              value={totalAnnualIncome > 0 ? fmtIdrCompact(totalAnnualIncome) : "N/A"}
              fullValue={totalAnnualIncome > 0 ? fmtIdr(totalAnnualIncome) : "N/A"}
              sub={avgCoupon != null ? `Avg ${avgCoupon.toFixed(2)}% · ${new Set(holdings.map((b) => b.series_code)).size} series` : undefined}
            />
          </div>
        </div>
      )}

      {creating && (
        <Modal title="Add Bond" onClose={() => setCreating(false)}>
          <BondForm onCancel={() => setCreating(false)} onSave={(v) => save(v, null)} />
        </Modal>
      )}

      {holdings.length === 0 ? (
        <EmptyState message="No active bond holdings." />
      ) : (
        <>
          {/* ── By Product summary ── */}
          <p className="text-xs font-semibold text-tdim">BY PRODUCT</p>

          {/* Product summary — desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  {(["series","total_principal","avg_coupon","annual_income","total_received","maturity"] as const).map((col, i) => {
                    const labels: Record<string, string> = { series:"SERIES", total_principal:"TOTAL PRINCIPAL", avg_coupon:"AVG COUPON", annual_income:"EST. ANNUAL INCOME", total_received:"RECEIVED", maturity:"MATURITY" };
                    const active = bondSort.col === col;
                    const alignRight = col !== "series" && col !== "maturity";
                    return (
                      <th key={col} onClick={() => toggleBondSort(col)}
                        className={`cursor-pointer select-none pb-2 pr-4 ${i === 0 ? "text-left" : alignRight ? "text-right" : "text-left"} hover:text-tprimary ${active ? "text-tprimary" : ""}`}>
                        {labels[col]}{active ? (bondSort.dir === "desc" ? " ↓" : " ↑") : ""}
                      </th>
                    );
                  })}
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {productRows.map((r) => {
                  const days = daysToMaturity(r.maturity_date);
                  return (
                    <tr key={r.code} className="border-t border-edge">
                      <td className="py-2 pr-4 font-medium text-tprimary">
                        <span className="rounded bg-edge px-1.5 py-0.5 text-xs text-tmuted">{r.series_type}</span>{" "}
                        {r.code}
                      </td>
                      <td className="num py-2 pr-4 text-right">{fmtIdr(r.total_principal)}</td>
                      <td className="num py-2 pr-4 text-right">
                        {r.avg_coupon != null ? `${r.avg_coupon.toFixed(2)}%` : "—"}
                      </td>
                      <td className="num py-2 pr-4 text-right text-up">
                        {r.annual_income > 0 ? fmtIdr(r.annual_income) : "—"}
                      </td>
                      <td className="num py-2 pr-4 text-right">
                        {r.total_received > 0 ? <span className="text-up">{fmtIdr(r.total_received)}</span> : <span className="text-tdim">—</span>}
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-4 ${maturityClass(days)}`}>
                        {r.maturity_date ? fmtWibDate(r.maturity_date) : "—"}
                        {days != null && (
                          <span className="ml-1 text-xs">({days < 0 ? "matured" : fmtDuration(days)})</span>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => setBulkPayFor(r.code)} className="text-xs text-btn hover:opacity-80 whitespace-nowrap">
                            Log Payment
                          </button>
                          {(schedules.some((s) => s.series_code === r.code) || seriesWithPayments.has(r.code)) && (
                            <button onClick={() => { setScheduleFor(r.code); setSchedLogDate(null); setSchedulePage(1); }} className="text-xs text-tdim hover:text-tprimary whitespace-nowrap">
                              Schedule
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Product summary — mobile */}
          <div className="space-y-2 md:hidden">
            {productRows.map((r) => {
              const days = daysToMaturity(r.maturity_date);
              return (
                <div key={r.code} className="rounded-lg border border-edge bg-component p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="rounded bg-edge px-1.5 py-0.5 text-xs text-tmuted">{r.series_type}</span>{" "}
                      <span className="font-medium text-tprimary">{r.code}</span>
                    </div>
                    <span className="text-xs text-tdim">{r.txCount} txn</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-tdim">Principal </span><span className="num text-tprimary">{fmtIdr(r.total_principal)}</span></div>
                    <div><span className="text-tdim">Coupon </span><span className="num text-tprimary">{r.avg_coupon != null ? `${r.avg_coupon.toFixed(2)}%` : "—"}</span></div>
                    <div><span className="text-tdim">Annual </span><span className="num text-up">{r.annual_income > 0 ? fmtIdr(r.annual_income) : "—"}</span></div>
                    <div><span className="text-tdim">Received </span><span className="num text-up">{r.total_received > 0 ? fmtIdr(r.total_received) : "—"}</span></div>
                    {r.maturity_date && (
                      <div className="col-span-2">
                        <span className="text-tdim">Maturity </span>
                        <span className={maturityClass(days)}>{fmtWibDate(r.maturity_date)}</span>
                        {days != null && <span className="ml-1 text-xs text-tdim">({days < 0 ? "matured" : fmtDuration(days)})</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Transactions ── */}
          <p className="text-xs font-semibold text-tdim">TRANSACTIONS</p>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map(({ b, totalReceived: rcvd, lastPaidAt, capitalGain, annualIncome }) => {
              const days = daysToMaturity(b.maturity_date);
              return (
                <div key={b.id} className="rounded-lg border border-edge bg-component p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="rounded bg-edge px-1.5 py-0.5 text-xs text-tmuted">{b.series_type}</span>{" "}
                      <span className="font-medium text-tprimary">{b.series_code}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {days != null && (
                        <span className={`text-xs ${maturityClass(days)}`}>
                          {days < 0 ? "matured" : fmtDuration(days)}
                        </span>
                      )}
                      <button
                        onClick={() => setLoggingPayment({ bondId: b.id, seriesCode: b.series_code })}
                        className="text-xs text-btn hover:opacity-80"
                      >Coupon</button>
                      <button
                        onClick={() => setEditing({
                          id: b.id, seriesType: b.series_type, seriesCode: b.series_code,
                          platform: b.platform ?? "", principal: String(b.principal),
                          purchasePrice: b.purchase_price != null ? String(b.purchase_price) : "",
                          coupon: b.coupon_rate != null ? String(b.coupon_rate) : "",
                          maturity: b.maturity_date ?? "", notes: b.notes ?? "",
                          purchased: (b.purchased_at ?? "").slice(0, 10) || todayInput(),
                        })}
                        className="text-xs text-tdim hover:text-tprimary"
                      >Edit</button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-tdim">Principal </span><span className="num text-tprimary">{fmtIdr(b.principal)}</span></div>
                    <div><span className="text-tdim">Coupon </span><span className="num text-tprimary">{b.coupon_rate != null ? `${b.coupon_rate}%` : "—"}</span></div>
                    {b.purchase_price != null && (
                      <div><span className="text-tdim">Paid </span><span className="num text-tprimary">{fmtIdr(b.purchase_price)}</span></div>
                    )}
                    {capitalGain != null && (
                      <div><span className="text-tdim">Cap. gain </span><span className={`num ${capitalGain >= 0 ? "text-up" : "text-down"}`}>{fmtIdr(capitalGain)}</span></div>
                    )}
                    <div><span className="text-tdim">Rcvd </span><span className="num text-up">{rcvd > 0 ? fmtIdr(rcvd) : "—"}</span></div>
                    {annualIncome != null && (
                      <div><span className="text-tdim">Annual </span><span className="num text-tprimary">{fmtIdr(annualIncome)}</span></div>
                    )}
                    {lastPaidAt && (
                      <div><span className="text-tdim">Last paid </span><span className="text-tprimary">{fmtWibDate(lastPaidAt)}</span></div>
                    )}
                    {b.platform && <div><span className="text-tdim">Platform </span><span className="text-tprimary">{b.platform}</span></div>}
                    {b.maturity_date && (
                      <div className="col-span-2">
                        <span className="text-tdim">Maturity </span>
                        <span className={`num ${maturityClass(days)}`}>{fmtWibDate(b.maturity_date)}</span>
                      </div>
                    )}
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
                  <th className="pb-2 pr-4 text-left">SERIES</th>
                  <th className="pb-2 pr-4 text-left">PLATFORM</th>
                  <th className="pb-2 pr-4 text-right">PRINCIPAL</th>
                  <th className="pb-2 pr-4 text-right">PAID / CAP. GAIN</th>
                  <th className="pb-2 pr-4 text-right">COUPON</th>
                  <th className="pb-2 pr-4 text-right">RECEIVED</th>
                  <th className="pb-2 pr-4 text-left">MATURITY</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ b, totalReceived: rcvd, lastPaidAt, capitalGain }) => {
                  const days = daysToMaturity(b.maturity_date);
                  return (
                    <tr key={b.id} className="border-t border-edge">
                      <td className="py-2 pr-4 font-medium text-tprimary">
                        <span className="rounded bg-edge px-1.5 py-0.5 text-xs text-tmuted">{b.series_type}</span>{" "}
                        {b.series_code}
                      </td>
                      <td className="py-2 pr-4 text-tmuted">{b.platform || "—"}</td>
                      <td className="num py-2 pr-4 text-right">{fmtIdr(b.principal)}</td>
                      <td className="num whitespace-nowrap py-2 pr-4 text-right">
                        {b.purchase_price != null ? (
                          <>
                            <span>{fmtIdr(b.purchase_price)}</span>
                            <span className={`ml-1 text-xs ${capitalGain != null && capitalGain >= 0 ? "text-up" : "text-down"}`}>
                              ({capitalGain != null ? fmtIdr(capitalGain) : "—"})
                            </span>
                          </>
                        ) : "—"}
                      </td>
                      <td className="num whitespace-nowrap py-2 pr-4 text-right">
                        {b.coupon_rate != null ? `${b.coupon_rate}%` : "—"}
                        {lastPaidAt && <span className="ml-1 text-[10px] text-tdim">· {fmtWibDate(lastPaidAt)}</span>}
                      </td>
                      <td className="num py-2 pr-4 text-right">
                        {rcvd > 0 ? <span className="text-up">{fmtIdr(rcvd)}</span> : <span className="text-tdim">—</span>}
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-4 ${maturityClass(days)}`}>
                        {b.maturity_date ? fmtWibDate(b.maturity_date) : "—"}
                        {days != null && (
                          <span className="ml-1 text-xs">({days < 0 ? "matured" : fmtDuration(days)})</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => setLoggingPayment({ bondId: b.id, seriesCode: b.series_code })}
                            className="text-xs text-btn hover:opacity-80"
                          >Coupon</button>
                          <button
                            onClick={() => setEditing({
                              id: b.id, seriesType: b.series_type, seriesCode: b.series_code,
                              platform: b.platform ?? "", principal: String(b.principal),
                              purchasePrice: b.purchase_price != null ? String(b.purchase_price) : "",
                              coupon: b.coupon_rate != null ? String(b.coupon_rate) : "",
                              maturity: b.maturity_date ?? "", notes: b.notes ?? "",
                              purchased: (b.purchased_at ?? "").slice(0, 10) || todayInput(),
                            })}
                            className="text-xs text-tdim hover:text-tprimary"
                          >Edit</button>
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

      {editing && (
        <Modal title="Edit Bond" onClose={() => setEditing(null)}>
          <BondForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={(v) => save(v, editing.id)}
            onDeactivate={() => deactivate(editing.id)}
          />
        </Modal>
      )}

      {loggingPayment && (
        <Modal title={`Log Coupon — ${loggingPayment.seriesCode}`} onClose={() => setLoggingPayment(null)}>
          <CouponForm
            onCancel={() => setLoggingPayment(null)}
            onSave={(amount, paidAt, notes) => savePayment(loggingPayment.bondId, amount, paidAt, notes)}
          />
        </Modal>
      )}

      {bulkPayFor && (
        <Modal title={`Log Coupon Payment — ${bulkPayFor}`} onClose={() => setBulkPayFor(null)}>
          <BulkPaymentForm
            seriesCode={bulkPayFor}
            holdings={holdings.filter((h) => h.series_code === bulkPayFor && h.active)}
            onCancel={() => setBulkPayFor(null)}
            onSave={(total, paidAt, notes) => saveBulkPayment(bulkPayFor, total, paidAt, notes)}
          />
        </Modal>
      )}

      {scheduleFor && (() => {
        const seriesHoldings = holdings.filter((b) => b.series_code === scheduleFor);
        const seriesHoldingIds = new Set(seriesHoldings.map((b) => b.id));
        const holdingById = new Map(seriesHoldings.map((h) => [h.id, h]));
        const seriesPays = payments.filter((p) => seriesHoldingIds.has(p.bond_holding_id));

        // Merge KSEI schedule dates with dates we've actually logged, so a
        // manually-entered payment (no schedule row) still shows up here.
        const schedByDate = new Map(
          schedules.filter((s) => s.series_code === scheduleFor).map((s) => [s.distribution_date, s]),
        );
        const paysByDate = new Map<string, BondCouponPayment[]>();
        for (const p of seriesPays) {
          const list = paysByDate.get(p.paid_at) ?? [];
          list.push(p);
          paysByDate.set(p.paid_at, list);
        }
        const allDates = Array.from(new Set([...schedByDate.keys(), ...paysByDate.keys()]))
          .sort((a, b) => b.localeCompare(a));

        // Distribution dates before all of our purchases fall in the record-date gap — bought
        // in secondary market after that coupon was already paid out to the prior holder.
        const earliestPurchase = seriesHoldings.reduce((min, h) => (!min || h.purchased_at < min ? h.purchased_at : min), null as string | null);
        const today = new Date().toISOString().slice(0, 10);
        const SCHEDULE_PAGE_SIZE = 25;
        const totalPages = Math.max(1, Math.ceil(allDates.length / SCHEDULE_PAGE_SIZE));
        const page = Math.min(schedulePage, totalPages);
        const pageDates = allDates.slice((page - 1) * SCHEDULE_PAGE_SIZE, page * SCHEDULE_PAGE_SIZE);

        const logEligible = schedLogDate
          ? seriesHoldings.filter((h) => h.active && h.purchased_at <= schedLogDate)
          : [];

        // Prefill each holding with its last recorded payout, else a rate-derived
        // net estimate using the cadence inferred from the KSEI schedule.
        const latestPay = latestPaymentByHolding(seriesPays);
        const seriesDatesByHolding = new Map<number, string[]>();
        for (const s of schedules) {
          if (s.series_code !== scheduleFor) continue;
          const list = seriesDatesByHolding.get(s.bond_holding_id) ?? [];
          list.push(s.distribution_date);
          seriesDatesByHolding.set(s.bond_holding_id, list);
        }
        const prefill = Object.fromEntries(logEligible.map((h) => [
          h.id,
          String(Math.round(
            latestPay.get(h.id)
              ?? (h.coupon_rate != null
                ? estimateCouponNet(h.principal, h.coupon_rate, inferPaymentsPerYear(seriesDatesByHolding.get(h.id) ?? []))
                : 0),
          ) || ""),
        ]));

        // Most recent KSEI scrape for this series — surfaces schedule freshness.
        const lastScraped = schedules
          .filter((s) => s.series_code === scheduleFor && s.scraped_at)
          .reduce<string | null>((max, s) => (!max || s.scraped_at > max ? s.scraped_at : max), null);

        return (
          <Modal
            title={schedLogDate ? `Log Coupon — ${scheduleFor} · ${fmtWibDate(schedLogDate)}` : `Coupon Schedule — ${scheduleFor}`}
            onClose={() => { setScheduleFor(null); setSchedLogDate(null); }}
          >
            {schedLogDate ? (
              <ScheduleLogForm
                seriesCode={scheduleFor}
                holdings={logEligible}
                prefill={prefill}
                onBack={() => setSchedLogDate(null)}
                onSave={(rows, notes) => saveSchedulePayment(schedLogDate, rows, notes)}
              />
            ) : (
              <>
                {lastScraped
                  ? <p className="mb-2 text-xs text-tdim">KSEI schedule last synced {fmtAgo(lastScraped)}</p>
                  : <p className="mb-2 text-xs text-tdim">No KSEI sync yet — dates below are logged payments only</p>}
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-component">
                      <tr className="text-xs font-semibold text-tdim">
                        <th className="pb-2 pr-6 text-left">DATE</th>
                        <th className="pb-2 text-left">STATUS</th>
                        <th className="pb-2 pl-4 text-right">AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageDates.map((date) => {
                        const sched = schedByDate.get(date);
                        const pays = paysByDate.get(date) ?? [];
                        const paid = pays.length > 0;
                        const totalOnDate = pays.reduce((s, p) => s + p.amount, 0);
                        const past = date < today;
                        const upcoming = !past && date <= new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
                        const notEntitled = !earliestPurchase || date < earliestPurchase;
                        return (
                          <tr key={date} className="border-t border-edge align-top">
                            <td className={`py-1.5 pr-6 ${notEntitled ? "text-tdim line-through decoration-tdim/50" : past ? "text-tdim" : upcoming ? "text-up" : "text-tprimary"}`}>
                              {fmtWibDate(date)}
                            </td>
                            <td className={`py-1.5 text-xs ${past ? "text-tdim" : "text-tmuted"}`}>
                              {sched?.status ?? (paid ? "logged" : "—")}
                            </td>
                            <td className="py-1.5 pl-4 text-right text-xs">
                              {notEntitled ? (
                                <span className="text-tdim">N/A · bought after</span>
                              ) : paid ? (
                                <div>
                                  <span className="num text-up">{fmtIdr(totalOnDate)}</span>
                                  {pays.length > 1 && pays.map((p) => (
                                    <div key={p.id} className="text-[10px] text-tdim">
                                      {holdingById.get(p.bond_holding_id)?.platform || scheduleFor} · <span className="num">{fmtIdr(p.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <button onClick={() => setSchedLogDate(date)} className="text-btn hover:opacity-80">
                                  Log
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {allDates.length === 0 && <p className="py-4 text-center text-sm text-tdim">No schedule entries.</p>}
                </div>
                {totalPages > 1 && (
                  <div className="mt-3 flex items-center justify-between text-xs text-tdim">
                    <button
                      onClick={() => setSchedulePage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded-md border border-edge px-2.5 py-1 text-tmuted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <span>Page {page} of {totalPages}</span>
                    <button
                      onClick={() => setSchedulePage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded-md border border-edge px-2.5 py-1 text-tmuted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}

function BondForm({
  initial,
  onCancel,
  onSave,
  onDeactivate,
}: {
  initial?: FormVals;
  onCancel: () => void;
  onSave: (v: FormVals) => Promise<void>;
  onDeactivate?: () => Promise<void>;
}) {
  const [seriesType, setSeriesType] = useState<SeriesType>(initial?.seriesType ?? "ORI");
  const [seriesCode, setSeriesCode] = useState(initial?.seriesCode ?? "");
  const [platform, setPlatform] = useState(initial?.platform ?? "");
  const [principal, setPrincipal] = useState(initial?.principal ?? "");
  const [purchasePrice, setPurchasePrice] = useState(initial?.purchasePrice ?? "");
  const [coupon, setCoupon] = useState(initial?.coupon ?? "");
  const [maturity, setMaturity] = useState(initial?.maturity ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [purchased, setPurchased] = useState(initial?.purchased ?? todayInput());
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  function vals(): FormVals {
    return { seriesType, seriesCode, platform, principal, purchasePrice, coupon, maturity, notes, purchased };
  }
  async function run(kind: "save" | "remove", fn: () => Promise<void>) {
    setBusy(kind);
    try { await fn(); } catch { setBusy(null); }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Series Type</span>
          <select
            value={seriesType}
            onChange={(e) => setSeriesType(e.target.value as SeriesType)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          >
            {SERIES_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Series Code</span>
          <input
            placeholder="e.g. ORI025"
            value={seriesCode}
            onChange={(e) => setSeriesCode(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Platform</span>
          <input
            placeholder="e.g. Bibit, BCA"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Principal (IDR)</span>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Purchase Price (IDR) <span className="text-tdim opacity-60">optional</span></span>
          <input
            type="number"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Coupon Rate (%) <span className="text-tdim opacity-60">optional</span></span>
          <input
            type="number"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Maturity Date</span>
          <input
            type="date"
            value={maturity}
            onChange={(e) => setMaturity(e.target.value)}
            className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Purchase Date</span>
          <input
            type="date"
            value={purchased}
            onChange={(e) => setPurchased(e.target.value)}
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
          onClick={() => run("save", () => onSave(vals()))}
          disabled={!seriesCode.trim() || !principal || busy !== null}
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

function CouponForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (amount: number, paidAt: string, notes: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const canSave = amountNum > 0 && !!paidAt;

  async function run() {
    setBusy(true);
    try { await onSave(amountNum, paidAt, notes); } catch { setBusy(false); }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Amount Received (IDR)</span>
          <input
            autoFocus
            type="number"
            placeholder="e.g. 541667"
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
          {busy ? "Saving…" : "Log Payment"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ScheduleLogForm({
  seriesCode,
  holdings,
  prefill,
  onBack,
  onSave,
}: {
  seriesCode: string;
  holdings: BondHolding[];
  prefill: Record<number, string>;
  onBack: () => void;
  onSave: (rows: { bondId: number; amount: number }[], notes: string) => Promise<void>;
}) {
  const [amounts, setAmounts] = useState<Record<number, string>>(
    () => Object.fromEntries(holdings.map((h) => [h.id, prefill[h.id] ?? ""])),
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = holdings.map((h) => ({ bondId: h.id, amount: Number(amounts[h.id]) || 0 }));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const canSave = total > 0;

  async function run() {
    setBusy(true);
    try { await onSave(rows.filter((r) => r.amount > 0), notes); } catch { setBusy(false); }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-xs text-tdim hover:text-tprimary">← Back to schedule</button>
      {holdings.length === 0 ? (
        <p className="py-4 text-center text-sm text-tdim">No holdings were purchased by this date.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-tdim">
            Amount received per holding. Prefilled from the last recorded payout (or a coupon-rate estimate) — adjust to the actual amount.
          </p>
          <div className="space-y-2">
            {holdings.map((h) => (
              <label key={h.id} className="flex items-center justify-between gap-3">
                <span className="text-xs text-tmuted">{h.platform || seriesCode} · {fmtIdr(h.principal)}</span>
                <input
                  type="number"
                  value={amounts[h.id] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [h.id]: e.target.value }))}
                  className="num w-40 rounded-md border border-edge bg-page px-3 py-2 text-right text-tprimary"
                />
              </label>
            ))}
          </div>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs text-tdim">Notes <span className="text-tdim opacity-60">optional</span></span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-md border border-edge bg-page px-3 py-2 text-tprimary"
            />
          </label>
          <div className="mt-2 text-right text-xs text-tdim">
            Total <span className="num text-tprimary">{fmtIdr(total)}</span>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={run}
              disabled={!canSave || busy}
              className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Log Payment"}
            </button>
            <button onClick={onBack} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BulkPaymentForm({
  seriesCode,
  holdings,
  onCancel,
  onSave,
}: {
  seriesCode: string;
  holdings: BondHolding[];
  onCancel: () => void;
  onSave: (total: number, paidAt: string, notes: string) => Promise<void>;
}) {
  const [total, setTotal] = useState("");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const totalNum = Number(total);
  // Only holdings already purchased by the distribution date are entitled to the coupon —
  // secondary-market buys made after paidAt weren't held on the record date.
  const eligible = holdings.filter((h) => h.purchased_at <= paidAt);
  const excluded = holdings.filter((h) => h.purchased_at > paidAt);
  const totalPrincipal = eligible.reduce((s, h) => s + h.principal, 0);
  const canSave = totalNum > 0 && !!paidAt && eligible.length > 0;

  async function run() {
    setBusy(true);
    try { await onSave(totalNum, paidAt, notes); } catch { setBusy(false); }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-tdim">Total Amount Received (IDR)</span>
          <input
            autoFocus
            type="number"
            placeholder="e.g. 1250000"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
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
      {totalNum > 0 && totalPrincipal > 0 && (
        <div className="mt-3 rounded-md border border-edge bg-page/50 p-3">
          <p className="mb-2 text-xs font-semibold text-tdim">SPLIT PREVIEW</p>
          <div className="space-y-1">
            {eligible.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-xs">
                <span className="text-tmuted">{h.platform || seriesCode} · {fmtIdr(h.principal)}</span>
                <span className="num text-tprimary">{fmtIdr(Math.round((h.principal / totalPrincipal) * totalNum))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {excluded.length > 0 && (
        <p className="mt-2 text-xs text-tdim">
          Excluded — bought after payment date, not entitled to this coupon: {excluded.map((h) => h.platform || seriesCode).join(", ")}
        </p>
      )}
      {totalNum > 0 && totalPrincipal === 0 && (
        <p className="mt-2 text-xs text-tdim">No holdings were purchased by this date — nothing to split.</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={run}
          disabled={!canSave || busy}
          className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Log Payment"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted disabled:opacity-60">
          Cancel
        </button>
      </div>
    </div>
  );
}
