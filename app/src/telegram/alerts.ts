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
