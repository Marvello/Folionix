import { WIB } from '../../../lib/format'

// ── TECHNICAL INDICATORS ────────────────────────────────────────────────────
// Computed from our own stock_snapshots history (no external provider).
// Snapshots are intraday-frequent; collapse to one close per WIB calendar day
// (the day's last snapshot) before computing daily indicators.

export interface SeriesRow {
  current_price: number | null
  volume: number | null
  fetched_at: string
}

export interface DailyPoint {
  date: string // YYYY-MM-DD (WIB)
  close: number
  volume: number | null
}

export interface Indicators {
  sma20: number | null
  sma50: number | null
  rsi14: number | null
  /** close vs close 5 trading days ago, % */
  mom1wPct: number | null
  /** last day's volume vs 20-day average volume */
  volRatio20: number | null
  /** stock 1W momentum minus IHSG 1W momentum, percentage points */
  relStrength1wPct?: number | null
}

/** Collapse intraday snapshots (ascending fetched_at) into daily closes. */
export function toDailySeries(rows: SeriesRow[]): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>()
  for (const r of rows) {
    if (r.current_price == null) continue
    const date = new Date(r.fetched_at).toLocaleDateString('en-CA', { timeZone: WIB })
    // ascending input → later rows overwrite = day's last snapshot wins
    byDay.set(date, { date, close: r.current_price, volume: r.volume })
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  return avg(closes.slice(-period))
}

/** Simple (non-Wilder) RSI over the last `period` daily changes. */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  const recent = closes.slice(-(period + 1))
  let gains = 0
  let losses = 0
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i] - recent[i - 1]
    if (d > 0) gains += d
    else losses -= d
  }
  if (gains + losses === 0) return 50
  if (losses === 0) return 100
  const rs = (gains / period) / (losses / period)
  return 100 - 100 / (1 + rs)
}

/** % change vs `days` trading days ago; null when not enough history. */
export function momentumPct(daily: DailyPoint[], days: number): number | null {
  if (daily.length < days + 1) return null
  const now = daily[daily.length - 1].close
  const then = daily[daily.length - 1 - days].close
  if (!then) return null
  return ((now - then) / then) * 100
}

export function computeIndicators(
  daily: DailyPoint[],
  indexDaily?: DailyPoint[],
): Indicators | null {
  if (daily.length < 2) return null
  const closes = daily.map(d => d.close)

  const mom1wPct = momentumPct(daily, 5)
  const idxMom = indexDaily ? momentumPct(indexDaily, 5) : null
  const volumes = daily.map(d => d.volume).filter((v): v is number => v != null && v > 0)
  const lastVol = daily[daily.length - 1].volume
  const volRatio20 =
    lastVol != null && lastVol > 0 && volumes.length >= 20
      ? lastVol / avg(volumes.slice(-20))
      : null

  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    rsi14: rsi(closes, 14),
    mom1wPct,
    volRatio20,
    relStrength1wPct: mom1wPct != null && idxMom != null ? mom1wPct - idxMom : null,
  }
}

/** Human label for an RSI value, for small-model readability. */
export function rsiLabel(rsi14: number): string {
  if (rsi14 >= 70) return 'overbought'
  if (rsi14 >= 55) return 'bullish'
  if (rsi14 > 45) return 'neutral'
  if (rsi14 > 30) return 'bearish'
  return 'oversold'
}
