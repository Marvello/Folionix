import { WIB } from '../../../lib/format'

interface PrevAnalysis {
  recommendation?: string | null
  analysed_at?: string
}

interface AlertEvaluation {
  isSame: boolean
  recChanged: boolean
  newDay: boolean
  prevRec: string | null | undefined
}

export function evaluateAlert(
  prev: PrevAnalysis | null,
  recommendation: string,
  now: Date,
): AlertEvaluation {
  if (!prev) {
    return { isSame: false, recChanged: false, newDay: false, prevRec: null }
  }

  const recChanged = prev.recommendation !== recommendation

  // If no analysed_at, treat as new day to force re-alert
  let newDay = !prev.analysed_at
  if (prev.analysed_at) {
    const prevDate = new Date(prev.analysed_at).toLocaleDateString('id-ID', { timeZone: WIB })
    const nowDate = now.toLocaleDateString('id-ID', { timeZone: WIB })
    newDay = prevDate !== nowDate
  }

  const isSame = !recChanged && !newDay && recommendation !== 'UNKNOWN'

  return { isSame, recChanged, newDay, prevRec: prev.recommendation }
}

/**
 * Analysis gate: is a fresh LLM pass worth it?
 *
 * Previously this was "same WIB day + price moved < REC_STABILITY_PCT", which
 * reset every midnight and re-emitted an unchanged HOLD for every ticker each
 * morning. The day boundary carries no information — a flat stock is flat
 * across it. Gate on the two things that do: how far price moved since the
 * price the last recommendation was made at, and how stale that call is.
 */
export function shouldReanalyze(
  prev: { analysed_at?: string } | null,
  prevPrice: number | null | undefined,
  price: number | null | undefined,
  stabilityPct: number,
  maxAgeHours: number,
  now: Date,
): { reanalyze: boolean; reason: string } {
  if (!prev?.analysed_at) return { reanalyze: true, reason: 'no prior call' }
  if (price == null || prevPrice == null || prevPrice <= 0) {
    return { reanalyze: true, reason: 'no comparable price' }
  }

  const ageH = (now.getTime() - new Date(prev.analysed_at).getTime()) / 3_600_000
  if (ageH >= maxAgeHours) {
    return { reanalyze: true, reason: `stale (${ageH.toFixed(1)}h)` }
  }

  const delta = Math.abs(price - prevPrice) / prevPrice
  if (delta >= stabilityPct) {
    return { reanalyze: true, reason: `moved ${(delta * 100).toFixed(1)}%` }
  }

  return {
    reanalyze: false,
    reason: `Δ ${(delta * 100).toFixed(1)}% < ${(stabilityPct * 100).toFixed(0)}%, ${ageH.toFixed(1)}h old`,
  }
}
