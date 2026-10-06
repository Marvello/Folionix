import type { ValuationResult } from './valuation'
import type { StockSnapshotRow } from '../../../lib/types'
import type { Indicators } from './indicators'
import { rsiLabel } from './indicators'

// ── DETERMINISTIC ANALYST SCORES ────────────────────────────────────────────
// Rule-based sub-scores (-100..100) computed from data we already store: the
// technical indicators, snapshot fundamentals, and the latest news-sentiment
// score. No LLM — personas receive these pre-digested verdicts instead of raw
// number dumps, which a small local model reasons over far more reliably.

export interface SubScore {
  score: number       // -100 (bearish) .. 100 (bullish)
  rationale: string
}

export interface AnalystScores {
  technical: SubScore
  valuation: SubScore
  sentiment: SubScore
  momentum: SubScore
  composite: number   // equal-weight mean of available sub-scores
}

const clamp = (n: number): number => Math.max(-100, Math.min(100, Math.round(n)))

const NO_DATA: SubScore = { score: 0, rationale: 'insufficient data' }

function technicalScore(snap: StockSnapshotRow, ind: Indicators | null): SubScore {
  const price = snap.current_price
  if (!ind || price == null) return NO_DATA

  let score = 0
  const parts: string[] = []

  if (ind.sma20 != null) {
    const vs20 = ((price - ind.sma20) / ind.sma20) * 100
    score += clamp(vs20 * 8)   // ±5% vs SMA20 saturates ±40
    parts.push(`price ${vs20 >= 0 ? 'above' : 'below'} SMA20 by ${Math.abs(vs20).toFixed(1)}%`)
  }
  if (ind.sma20 != null && ind.sma50 != null) {
    const cross = ind.sma20 >= ind.sma50 ? 20 : -20
    score += cross
    parts.push(cross > 0 ? 'SMA20 above SMA50 (uptrend)' : 'SMA20 below SMA50 (downtrend)')
  }
  if (ind.rsi14 != null) {
    const label = rsiLabel(ind.rsi14)
    // Overbought penalizes, oversold rewards (mean-reversion bias)
    const rsiAdj = label === 'overbought' ? -30
      : label === 'bullish' ? 10
      : label === 'bearish' ? -10
      : label === 'oversold' ? 30
      : 0
    score += rsiAdj
    parts.push(`RSI14 ${ind.rsi14.toFixed(0)} (${label})`)
  }

  if (parts.length === 0) return NO_DATA
  return { score: clamp(score / 2), rationale: parts.join('; ') }
}

/**
 * Relative valuation from the sector-aware 3-way comparison (ai/valuation.ts):
 * a discount to peers scores positive, a premium negative — halved when quality
 * explains the gap — plus a smaller pull from the stock's own multi-year average.
 */
export function relativeValuationScore(v: ValuationResult): SubScore {
  if (v.value == null) return NO_DATA
  let score = 0
  const parts: string[] = []
  if (v.peers.diff != null) {
    let peer = Math.max(-50, Math.min(50, -v.peers.diff * 100))
    const explained = (v.peers.verdict === 'premium' && v.quality.verdict === 'stronger')
      || (v.peers.verdict === 'discount' && v.quality.verdict === 'weaker')
    if (explained) peer /= 2
    score += peer
    parts.push(`${v.multiple_name} ${v.peers.verdict} vs ${v.peers.count} peers${explained ? ` (explained by ${v.quality.verdict} ${v.quality.name})` : ''}`)
  }
  if (v.own.diff != null) {
    score += Math.max(-30, Math.min(30, -v.own.diff * 40))
    parts.push(`${v.own.verdict} its ${v.own.years}y average`)
  }
  if (parts.length === 0) return NO_DATA
  return { score: clamp(score), rationale: parts.join('; ') }
}

/** Fallback when no peer valuation exists yet: crude absolute bands. */
function valuationScore(snap: StockSnapshotRow): SubScore {
  let score = 0
  const parts: string[] = []

  if (snap.pe != null && snap.pe > 0) {
    // IDX-reasonable bands: <10 cheap, >25 expensive
    const peAdj = snap.pe < 10 ? 40 : snap.pe < 15 ? 20 : snap.pe <= 25 ? 0 : -30
    score += peAdj
    parts.push(`P/E ${snap.pe.toFixed(1)}`)
  }
  if (snap.pb != null && snap.pb > 0) {
    const pbAdj = snap.pb < 1 ? 30 : snap.pb < 2 ? 10 : snap.pb <= 4 ? 0 : -20
    score += pbAdj
    parts.push(`P/B ${snap.pb.toFixed(1)}`)
  }
  if (snap.div_yield_pct != null && snap.div_yield_pct > 0) {
    score += Math.min(30, snap.div_yield_pct * 5)
    parts.push(`dividend yield ${snap.div_yield_pct.toFixed(1)}%`)
  }
  if (snap.dist_from_high != null && snap.dist_from_high < -40) {
    score += 10
    parts.push(`${Math.abs(snap.dist_from_high).toFixed(0)}% below 52w high`)
  }

  if (parts.length === 0) return NO_DATA
  return { score: clamp(score), rationale: parts.join('; ') }
}

function sentimentScoreOf(newsScore: number | null): SubScore {
  // No news is no data — a fake 0 would dilute the composite by a quarter.
  if (newsScore == null) return NO_DATA
  // news_sentiments.score is -5..5
  return {
    score: clamp(newsScore * 20),
    rationale: `news sentiment ${newsScore >= 0 ? '+' : ''}${newsScore} of ±5`,
  }
}

function momentumScore(ind: Indicators | null): SubScore {
  if (!ind || ind.mom1wPct == null) return NO_DATA

  let score = clamp(ind.mom1wPct * 6)   // ±10% weekly move saturates ±60
  const parts = [`1W momentum ${ind.mom1wPct >= 0 ? '+' : ''}${ind.mom1wPct.toFixed(1)}%`]

  if (ind.relStrength1wPct != null) {
    score += clamp(ind.relStrength1wPct * 4)
    parts.push(`${ind.relStrength1wPct >= 0 ? 'out' : 'under'}performing IHSG by ${Math.abs(ind.relStrength1wPct).toFixed(1)}pp`)
  }
  if (ind.volRatio20 != null && ind.volRatio20 > 1.5) {
    // High volume is conviction: amplify whichever direction momentum points
    score = score * Math.min(1.5, ind.volRatio20 / 1.5)
    parts.push(`volume ${ind.volRatio20.toFixed(1)}x 20d average`)
  }

  return { score: clamp(score), rationale: parts.join('; ') }
}

export function computeAnalystScores(
  snap: StockSnapshotRow,
  indicators: Indicators | null,
  newsScore: number | null,
  peerValuation?: ValuationResult | null,
): AnalystScores {
  const technical = technicalScore(snap, indicators)
  const relative = peerValuation ? relativeValuationScore(peerValuation) : NO_DATA
  const valuation = relative !== NO_DATA ? relative : valuationScore(snap)
  const sentiment = sentimentScoreOf(newsScore)
  const momentum = momentumScore(indicators)

  const scored = [technical, valuation, sentiment, momentum]
    .filter(s => s.rationale !== NO_DATA.rationale)
  const composite = scored.length > 0
    ? clamp(scored.reduce((a, s) => a + s.score, 0) / scored.length)
    : 0

  return { technical, valuation, sentiment, momentum, composite }
}
