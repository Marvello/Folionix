// Sector-aware peer valuation (dashboard side). The verdicts are computed by
// app/src/ai/valuation.ts and read from stock_valuation; this file only
// re-derives each *peer's* multiple and quality metric for the compact peer
// table, using the same formulas as the backend's multipleOf / qualityOf.

export type Lens = "PB_ROE" | "PE_GROWTH" | "EV_EBITDA" | "EV_EBITDA_MIDCYCLE" | "PS_GROWTH" | "PB_YIELD";

/** stock_valuation.result (written by the app). */
export interface ValuationResult {
  ticker: string;
  lens: Lens;
  multiple_name: string;
  value: number | null;
  peers: { count: number; median: number | null; diff: number | null; verdict: string; tickers: string[] };
  quality: { name: string; value: number | null; peer_median: number | null; verdict: string };
  own: { avg: number | null; years: number; diff: number | null; verdict: string };
  read: string;
  summary: string;
}

export interface Valuation {
  ticker: string;
  computed_at: string;
  result: ValuationResult;
}

/** stock_peers row joined with the peer's classification name and key stats. */
export interface PeerRow {
  ticker: string;
  peer: string;
  rank: number;
  basis: "sub_industry" | "industry";
  group_name: string;
  name: string | null;
  market_cap: number | null;
  trailing_pe: number | null;
  price_to_book: number | null;
  total_revenue: number | null;
  ebitda: number | null;
  total_debt: number | null;
  total_cash: number | null;
  return_on_equity: number | null;
  earnings_growth: number | null;
  revenue_growth: number | null;
  ebitda_margins: number | null;
}

const pos = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) && v > 0 ? v : null);
const num = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);

/** EV/EBITDA from current figures; mid-cycle peers use it too (no multi-year EBITDA on the web side). */
function evEbitda(p: PeerRow): number | null {
  const mc = pos(p.market_cap);
  const e = pos(p.ebitda);
  return mc != null && e != null ? pos((mc + (p.total_debt ?? 0) - (p.total_cash ?? 0)) / e) : null;
}

/** The lens's multiple for a peer, or null when inputs are missing / meaningless. */
export function peerMultiple(lens: Lens, p: PeerRow): number | null {
  switch (lens) {
    case "PB_ROE":
    case "PB_YIELD":
      return pos(p.price_to_book);
    case "PE_GROWTH":
      return pos(p.trailing_pe);
    case "EV_EBITDA":
    case "EV_EBITDA_MIDCYCLE":
      return evEbitda(p);
    case "PS_GROWTH": {
      const mc = pos(p.market_cap);
      const r = pos(p.total_revenue);
      return mc != null && r != null ? mc / r : null;
    }
  }
}

/** The lens's quality metric for a peer: a fraction, or net debt/EBITDA as a plain ratio. */
export function peerQuality(lens: Lens, p: PeerRow, divYieldPct: number | null | undefined): number | null {
  switch (lens) {
    case "PB_ROE":
      return num(p.return_on_equity);
    case "PE_GROWTH":
      return num(p.earnings_growth);
    case "EV_EBITDA":
      return num(p.ebitda_margins);
    case "EV_EBITDA_MIDCYCLE": {
      const e = pos(p.ebitda);
      return e != null ? ((p.total_debt ?? 0) - (p.total_cash ?? 0)) / e : null;
    }
    case "PS_GROWTH":
      return num(p.revenue_growth);
    case "PB_YIELD":
      return divYieldPct != null && Number.isFinite(divYieldPct) ? divYieldPct / 100 : null;
  }
}

/** Peer-table column header for the multiple: mid-cycle peers show *current* EV/EBITDA. */
export const peerMultipleLabel = (r: ValuationResult): string =>
  r.lens === "EV_EBITDA_MIDCYCLE" ? "EV/EBITDA (current)" : r.multiple_name;

/** `12.3×`, `85×` (≥ 100 drops the decimal), `—` when missing. */
export function fmtMultiple(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}×`;
}

/** Quality metric: `21.8%` for fractions, `0.4×` for net debt/EBITDA. */
export function fmtQuality(lens: Lens, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return lens === "EV_EBITDA_MIDCYCLE" ? `${v.toFixed(1)}×` : `${(v * 100).toFixed(1)}%`;
}

export const basisLabel = (b: string): string => (b === "industry" ? "industry" : "sub-industry");
