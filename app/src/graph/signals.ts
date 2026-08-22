// app/src/graph/signals.ts
import 'dotenv/config'
import type { TickerSignal, SignalType, SignalTier } from './state'

function getThresholds() {
  return {
    priceMinor: Number(process.env.SIGNAL_PRICE_MINOR ?? 3.0),
    priceMajor: Number(process.env.SIGNAL_PRICE_MAJOR ?? 5.0),
    volMinor:   Number(process.env.SIGNAL_VOLUME_MINOR ?? 1.5),
    volMajor:   Number(process.env.SIGNAL_VOLUME_MAJOR ?? 3.0),
  }
}

interface SignalResult {
  signal_type: SignalType
  tier: SignalTier
  value: number
}

export function classifySignal(dayChangePct: number, volumeRatio: number): SignalResult | null {
  const t = getThresholds()
  const absPct = Math.abs(dayChangePct)

  const priceTriggered = absPct >= t.priceMinor
  const volTriggered = volumeRatio >= t.volMinor
  const priceMajor = absPct >= t.priceMajor
  const volMajor = volumeRatio >= t.volMajor

  if (!priceTriggered && !volTriggered) return null

  let signal_type: SignalType
  if (priceTriggered && volTriggered) signal_type = 'COMBINED'
  else if (priceTriggered) signal_type = 'PRICE_MOVE'
  else signal_type = 'VOLUME_SPIKE'

  const tier: SignalTier = (priceMajor || volMajor || signal_type === 'COMBINED') ? 'MAJOR' : 'MINOR'
  const value = priceTriggered ? absPct : volumeRatio

  return { signal_type, tier, value }
}

/** Drop signals whose ticker was signal-analyzed within SIGNAL_COOLDOWN_MIN.
 *  Without this, a stock pinned at a big day move re-triggers MAJOR analysis
 *  every runner cycle and starves the scheduled cadence. */
export function filterCooledSignals(
  signals: TickerSignal[],
  cooldowns: Record<string, string>,
  nowMs: number = Date.now(),
): TickerSignal[] {
  const cooldownMin = Number(process.env.SIGNAL_COOLDOWN_MIN ?? 60)
  return signals.filter(s => {
    const last = cooldowns[s.ticker]
    if (!last) return true
    return (nowMs - new Date(last).getTime()) / 60_000 >= cooldownMin
  })
}

export function detectSignalsForTicker(
  ticker: string,
  snap: { day_change_pct: number | null; volume: number | null },
  prevSnap?: { volume: number | null } | null,
): TickerSignal[] {
  const dayChangePct = snap.day_change_pct ?? 0
  const volumeRatio = snap.volume && prevSnap?.volume && prevSnap.volume > 0
    ? snap.volume / prevSnap.volume
    : 0

  const result = classifySignal(dayChangePct, volumeRatio)
  if (!result) return []

  return [{
    ticker,
    signal_type: result.signal_type,
    tier: result.tier,
    value: result.value,
    detected_at: new Date().toISOString(),
  }]
}
