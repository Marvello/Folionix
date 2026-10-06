// ── SECTOR-AWARE VALUATION (3-way comparison) ───────────────────────────────
// Pure, deterministic: the LLM never computes these numbers, it only reads the
// summary. A stock is judged on the multiple that fits its sector, against
// (1) its peers' median, (2) a quality metric that can justify a gap, and
// (3) its own multi-year average.

export type Lens = 'PB_ROE' | 'PE_GROWTH' | 'EV_EBITDA' | 'EV_EBITDA_MIDCYCLE' | 'PS_GROWTH' | 'PB_YIELD'

/** Per-ticker inputs, all money in IDR, ratios as fractions (ROE 0.18). */
export interface ValuationInput {
  ticker: string
  sector: string | null
  market_cap: number | null
  trailing_pe: number | null
  price_to_book: number | null
  total_revenue: number | null
  ebitda: number | null
  total_debt: number | null
  total_cash: number | null
  return_on_equity: number | null
  earnings_growth: number | null
  revenue_growth: number | null
  ebitda_margins: number | null
  div_yield_pct: number | null
  /** Fiscal-year multiples, newest first (stock_annual_multiples). */
  annual?: Array<{ pe: number | null; pb: number | null; ps: number | null; ev_ebitda: number | null; ebitda: number | null; net_income: number | null }>
}

interface LensDef {
  multiple: string
  quality: string
  /** True when a higher quality value is better (ROE, growth, margin, yield). */
  qualityHigherBetter: boolean
}

export const LENSES: Record<Lens, LensDef> = {
  PB_ROE: { multiple: 'P/B', quality: 'ROE', qualityHigherBetter: true },
  PE_GROWTH: { multiple: 'P/E', quality: 'earnings growth', qualityHigherBetter: true },
  EV_EBITDA: { multiple: 'EV/EBITDA', quality: 'EBITDA margin', qualityHigherBetter: true },
  EV_EBITDA_MIDCYCLE: { multiple: 'EV/EBITDA (mid-cycle)', quality: 'net debt/EBITDA', qualityHigherBetter: false },
  PS_GROWTH: { multiple: 'P/S', quality: 'revenue growth', qualityHigherBetter: true },
  PB_YIELD: { multiple: 'P/B', quality: 'dividend yield', qualityHigherBetter: true },
}

/** IDX-IC sector → lens. Loss-making companies always fall back to P/S. */
export function lensFor(sector: string | null, lossMaking: boolean): Lens {
  if (lossMaking) return 'PS_GROWTH'
  switch (sector) {
    case 'Keuangan': return 'PB_ROE'
    case 'Barang Konsumen Primer':
    case 'Barang Konsumen Non-Primer':
    case 'Kesehatan': return 'PE_GROWTH'
    case 'Infrastruktur':
    case 'Transportasi & Logistik':
    case 'Perindustrian': return 'EV_EBITDA'
    case 'Energi':
    case 'Barang Baku': return 'EV_EBITDA_MIDCYCLE'
    case 'Teknologi': return 'PS_GROWTH'
    case 'Properti & Real Estat': return 'PB_YIELD'
    default: return 'PE_GROWTH'
  }
}

const pos = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) && v > 0 ? v : null)
const ev = (x: ValuationInput): number | null =>
  pos(x.market_cap) != null ? x.market_cap! + (x.total_debt ?? 0) - (x.total_cash ?? 0) : null

const avg = (xs: Array<number | null | undefined>): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x) && x > 0)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** The lens's multiple for one ticker, or null when inputs are missing / meaningless. */
export function multipleOf(lens: Lens, x: ValuationInput): number | null {
  switch (lens) {
    case 'PB_ROE':
    case 'PB_YIELD': return pos(x.price_to_book)
    case 'PE_GROWTH': return pos(x.trailing_pe)
    case 'EV_EBITDA': {
      const e = ev(x); const d = pos(x.ebitda)
      return e != null && d != null ? pos(e / d) : null
    }
    case 'EV_EBITDA_MIDCYCLE': {
      // Mid-cycle: smooth commodity peaks/troughs with the multi-year average EBITDA.
      const e = ev(x); const d = avg([x.ebitda, ...(x.annual ?? []).slice(0, 4).map((a) => a.ebitda)])
      return e != null && d != null ? pos(e / d) : null
    }
    case 'PS_GROWTH': {
      const m = pos(x.market_cap); const r = pos(x.total_revenue)
      return m != null && r != null ? m / r : null
    }
  }
}

/** The lens's quality metric (fractions; net debt/EBITDA as a plain ratio). */
export function qualityOf(lens: Lens, x: ValuationInput): number | null {
  const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null)
  switch (lens) {
    case 'PB_ROE': return num(x.return_on_equity)
    case 'PE_GROWTH': return num(x.earnings_growth)
    case 'EV_EBITDA': return num(x.ebitda_margins)
    case 'EV_EBITDA_MIDCYCLE': {
      const d = pos(x.ebitda)
      return d != null ? ((x.total_debt ?? 0) - (x.total_cash ?? 0)) / d : null
    }
    case 'PS_GROWTH': return num(x.revenue_growth)
    case 'PB_YIELD': return x.div_yield_pct != null ? x.div_yield_pct / 100 : null
  }
}

/** The same multiple on each of the stock's past fiscal years (own-history comparison). */
function ownHistory(lens: Lens, x: ValuationInput): { avg: number | null; years: number } {
  const rows = (x.annual ?? []).slice(0, 4)
  const pick = (r: NonNullable<ValuationInput['annual']>[number]) =>
    lens === 'PE_GROWTH' ? r.pe : lens === 'PS_GROWTH' ? r.ps : lens.startsWith('EV_') ? r.ev_ebitda : r.pb
  const vals = rows.map(pick).filter((v): v is number => v != null && v > 0)
  return { avg: vals.length >= 2 ? avg(vals) : null, years: vals.length }
}

export const PAR_BAND = 0.15          // within ±15% of the reference = on par
const QUALITY_BAND = 0.10              // within ±10% (relative) = similar quality
export const MIN_PEERS = 3

export interface ValuationResult {
  ticker: string
  lens: Lens
  multiple_name: string
  value: number | null
  peers: { count: number; median: number | null; diff: number | null; verdict: 'premium' | 'discount' | 'on par' | 'insufficient peers' | 'no data'; tickers: string[] }
  quality: { name: string; value: number | null; peer_median: number | null; verdict: 'stronger' | 'weaker' | 'similar' | 'n/a' }
  own: { avg: number | null; years: number; diff: number | null; verdict: 'above' | 'below' | 'in line' | 'insufficient history' }
  /** Does quality explain the gap to peers? */
  read: string
  summary: string
}

const rel = (a: number, b: number) => a / b - 1
const pct = (d: number) => `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`
const fmtMult = (v: number | null) => (v == null ? 'n/a' : `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}×`)
const fmtQ = (lens: Lens, v: number | null) =>
  v == null ? 'n/a' : lens === 'EV_EBITDA_MIDCYCLE' ? `${v.toFixed(1)}×` : `${(v * 100).toFixed(1)}%`

/** 3-way comparison for `stock` against `peers` (peers already selected, stock excluded). */
export function valuate(stock: ValuationInput, peers: ValuationInput[]): ValuationResult {
  // Loss-making = the latest fiscal year actually lost money (missing data is not a loss).
  const lossMaking = (stock.annual?.[0]?.net_income ?? 0) < 0
  const lens = lensFor(stock.sector, lossMaking)
  const def = LENSES[lens]
  const value = multipleOf(lens, stock)

  const peerVals = peers.map((p) => ({ t: p.ticker, m: multipleOf(lens, p) })).filter((p) => p.m != null) as Array<{ t: string; m: number }>
  const peerMedian = peerVals.length >= MIN_PEERS ? median(peerVals.map((p) => p.m)) : null
  const peerDiff = value != null && peerMedian != null ? rel(value, peerMedian) : null
  const peerVerdict = value == null ? 'no data'
    : peerMedian == null ? 'insufficient peers'
    : peerDiff == null ? 'insufficient peers'
    : Math.abs(peerDiff) <= PAR_BAND ? 'on par' : peerDiff > 0 ? 'premium' : 'discount'

  const q = qualityOf(lens, stock)
  const peerQ = median(peers.map((p) => qualityOf(lens, p)).filter((v): v is number => v != null))
  let qVerdict: ValuationResult['quality']['verdict'] = 'n/a'
  if (q != null && peerQ != null) {
    const gap = peerQ === 0 ? q : (q - peerQ) / Math.abs(peerQ)
    const better = def.qualityHigherBetter ? gap > QUALITY_BAND : gap < -QUALITY_BAND
    const worse = def.qualityHigherBetter ? gap < -QUALITY_BAND : gap > QUALITY_BAND
    qVerdict = better ? 'stronger' : worse ? 'weaker' : 'similar'
  }

  const hist = ownHistory(lens, stock)
  const ownDiff = value != null && hist.avg != null ? rel(value, hist.avg) : null
  const ownVerdict = ownDiff == null ? 'insufficient history'
    : Math.abs(ownDiff) <= PAR_BAND ? 'in line' : ownDiff > 0 ? 'above' : 'below'

  const read =
    peerVerdict === 'premium' ? (qVerdict === 'stronger' ? `premium backed by stronger ${def.quality}` : qVerdict === 'weaker' ? `premium NOT backed — weaker ${def.quality}` : `premium with similar ${def.quality} — looks rich`)
    : peerVerdict === 'discount' ? (qVerdict === 'weaker' ? `discount reflects weaker ${def.quality}` : qVerdict === 'stronger' ? `discount despite stronger ${def.quality} — possible value` : `discount with similar ${def.quality} — looks cheap`)
    : peerVerdict === 'on par' ? 'priced in line with peers'
    : peerVerdict === 'no data' ? `no ${def.multiple} available for this stock`
    : 'not enough comparable peers'

  const summary = [
    `${def.multiple} ${fmtMult(value)}`,
    peerMedian != null && peerDiff != null ? `vs peers ${fmtMult(peerMedian)} (${pct(peerDiff)}, ${peerVerdict}, n=${peerVals.length})` : `peers: ${peerVerdict}`,
    `${def.quality} ${fmtQ(lens, q)} vs peers ${fmtQ(lens, peerQ)} (${qVerdict})`,
    hist.avg != null && ownDiff != null ? `vs own ${hist.years}y avg ${fmtMult(hist.avg)} (${pct(ownDiff)}, ${ownVerdict})` : 'own history n/a',
  ].join(' · ') + ` → ${read}`

  return {
    ticker: stock.ticker, lens, multiple_name: def.multiple, value,
    peers: { count: peerVals.length, median: peerMedian, diff: peerDiff, verdict: peerVerdict, tickers: peerVals.map((p) => p.t) },
    quality: { name: def.quality, value: q, peer_median: peerQ, verdict: qVerdict },
    own: { avg: hist.avg, years: hist.years, diff: ownDiff, verdict: ownVerdict },
    read, summary,
  }
}
