import type { StockKeyStatsRow } from "@/lib/types";
import { fmtIdr, fmtIdrCompact } from "@/lib/format";

export type Stat = { label: string; value: string };
export type Group = { label: string; stats: Stat[] };

const pct = (v: number | null | undefined, alreadyPct = false): string | null =>
  v == null ? null : `${(alreadyPct ? v : v * 100).toFixed(1)}%`;
const ratio = (v: number | null | undefined): string | null =>
  v == null ? null : v.toFixed(2);
const big = (v: number | null | undefined): string | null =>
  v == null ? null : fmtIdr(v);
/** An absent stat is dropped from its group, so "N/A" becomes null here. */
const orNull = (formatted: string): string | null => (formatted === "N/A" ? null : formatted);
/** Large rupiah magnitudes (EV, cash, debt, FCF): compact with an IDR code. */
const compact = (v: number | null | undefined): string | null => orNull(fmtIdrCompact(v));
/** Share counts, not currency: compact with no currency code. */
const count = (v: number | null | undefined): string | null => orNull(fmtIdrCompact(v, ""));

/** Only populated stats survive, and an empty group is dropped whole. A thin
 *  small-cap gets a short card instead of a wall of N/A. */
export function statGroups(r: StockKeyStatsRow): Group[] {
  const raw: Group[] = [
    { label: "Valuation", stats: [
      { label: "Fwd P/E", value: ratio(r.forward_pe) },
      { label: "PEG", value: ratio(r.peg_ratio) },
      { label: "P/B", value: ratio(r.price_to_book) },
      { label: "EV", value: compact(r.enterprise_value) },
      { label: "Book value", value: big(r.book_value) },
    ]},
    { label: "Profitability", stats: [
      { label: "ROE", value: pct(r.return_on_equity) },
      { label: "Net margin", value: pct(r.profit_margins) },
      { label: "EBITDA margin", value: pct(r.ebitda_margins) },
      { label: "Revenue growth", value: pct(r.revenue_growth) },
      { label: "EPS growth", value: pct(r.earnings_growth) },
    ]},
    { label: "Health", stats: [
      { label: "Current ratio", value: ratio(r.current_ratio) },
      { label: "Quick ratio", value: ratio(r.quick_ratio) },
      { label: "Total cash", value: compact(r.total_cash) },
      { label: "Total debt", value: compact(r.total_debt) },
      { label: "Free cash flow", value: compact(r.free_cashflow) },
    ]},
    { label: "Street", stats: [
      { label: "Target", value: big(r.target_mean) },
      { label: "Range", value: r.target_low != null && r.target_high != null
        ? `${fmtIdr(r.target_low)} to ${fmtIdr(r.target_high)}` : null },
      { label: "Consensus", value: r.recommendation_key?.replace(/_/g, " ") ?? null },
      { label: "Analysts", value: r.analyst_count == null ? null : String(r.analyst_count) },
    ]},
    { label: "Ownership", stats: [
      { label: "Insiders", value: pct(r.held_pct_insiders) },
      { label: "Institutions", value: pct(r.held_pct_institutions) },
      { label: "Float", value: count(r.float_shares) },
      { label: "Shares out", value: count(r.shares_outstanding) },
      { label: "52w change", value: pct(r.change_52w) },
    ]},
  ].map((g) => ({
    label: g.label,
    stats: g.stats.filter((s): s is Stat => s.value != null),
  }));
  return raw.filter((g) => g.stats.length > 0);
}
