import { fmtIdr, fmtCap } from '../../../lib/format'
import type { StockSnapshotRow } from '../../../lib/types'
import { rsiLabel, type Indicators } from './indicators'

export type Depth = 'LIGHT' | 'FULL' | 'DEEP'

// ── HELPERS ────────────────────────────────────────────────────────────────

/** Compute current WIB (UTC+7) hour and minute from system clock. */
function nowWib(): { hour: number; minute: number } {
  const now = new Date()
  const wibOffset = 7 * 60 // UTC+7 in minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const wibMinutes = (utcMinutes + wibOffset) % (24 * 60)
  return { hour: Math.floor(wibMinutes / 60), minute: wibMinutes % 60 }
}

/** Derive an IDX market session label from current WIB time. */
function detectSession(): string {
  const { hour, minute } = nowWib()
  if (hour === 9 && minute === 0) return 'SESSION 1 OPEN (09:00)'
  if (hour === 10) return 'SESSION 1 — 10:00 WIB'
  if (hour === 11) return 'SESSION 1 — 11:00 WIB (1 hr to close)'
  if (hour === 12) return 'SESSION 1 CLOSE (12:00)'
  if (hour === 13) return 'SESSION 2 OPEN (13:30)'
  if (hour === 14 && minute >= 30) return 'SESSION 2 — 14:30 WIB (30 min to close ⚠️)'
  if (hour === 15) return 'MARKET CLOSE (15:00)'
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return `PORTFOLIO UPDATE (${hh}:${mm} WIB)`
}

function sign(n: number): string {
  return n >= 0 ? '+' : ''
}

function arrow(n: number | null | undefined): string {
  if (n == null) return '→'
  return n > 0 ? '📈' : n < 0 ? '📉' : '→'
}

function pnlStatus(pct: number | null | undefined): string {
  if (pct == null) return 'N/A'
  if (pct > 0) return '🟢 PROFIT'
  if (pct === 0) return '⚪ BREAKEVEN'
  if (pct > -5) return '🟡 SMALL LOSS'
  return '🔴 LOSS'
}

function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// ── BUILD PROMPT ───────────────────────────────────────────────────────────

export function buildPrompt(
  snapshot: StockSnapshotRow,
  history: StockSnapshotRow | null,
  depth: Depth,
  newsSentiment?: string,
  metadata?: { name?: string; sector?: string; industry?: string },
  indicators?: Indicators | null,
): string {
  const ticker = snapshot.ticker.replace('.JK', '')
  const price = snapshot.current_price ?? 0
  const dayPct = snapshot.day_change_pct ?? 0
  const lots = snapshot.lots ?? 0
  const avgPrice = snapshot.avg_price ?? 0
  const totalPnl = snapshot.total_pnl ?? 0
  const pnlPct = snapshot.unrealized_pnl_pct ?? 0
  const pnlPerShare = snapshot.unrealized_pnl ?? 0

  // Session label — derived from current WIB time
  const session = detectSession()

  // ── Investor position block ──
  let pnlBlock = ''
  if (avgPrice && price) {
    const totalInvest = avgPrice * lots * 100
    const ACTION_THRESHOLD = 1_000_000
    const aboveThresh = Math.abs(totalPnl) >= ACTION_THRESHOLD
    const distFromHigh =
      snapshot.high_52w && price
        ? fmtNum(((price - snapshot.high_52w) / snapshot.high_52w) * 100, 2)
        : 'N/A'
    const distFromLow =
      snapshot.low_52w && price
        ? fmtNum(((price - snapshot.low_52w) / snapshot.low_52w) * 100, 2)
        : 'N/A'
    const threshNote =
      `Total P&L Rp ${sign(totalPnl)}${fmtNum(totalPnl)} ` +
      `${aboveThresh ? '✅ above' : '⚠️ below'} action threshold ` +
      `(Rp ${fmtNum(ACTION_THRESHOLD)}). ` +
      `${aboveThresh ? 'Consider taking action.' : 'Monitor only — not material yet.'}`

    pnlBlock = `
INVESTOR POSITION:
- Lots Held             : ${lots} lot (${fmtNum(lots * 100)} shares)
- Capital Invested      : ${fmtCap(totalInvest)}
- Average Buy Price     : Rp ${fmtNum(avgPrice, 2)}
- Current Price         : ${fmtIdr(price)}
- P&L per Share         : ${fmtIdr(pnlPerShare)} (${sign(pnlPct)}${pnlPct.toFixed(2)}%)
- Total P&L             : Rp ${sign(totalPnl)}${fmtNum(totalPnl)}
- Status                : ${pnlStatus(pnlPct)}
- Action Threshold      : ${threshNote}
- Dist from 52W High    : ${distFromHigh}%
- Dist from 52W Low     : ${distFromLow}%`
  }

  // ── Fundamentals block (FULL and DEEP only) ──
  let fundamentalsBlock = ''
  if (depth !== 'LIGHT') {
    const pe = snapshot.pe != null ? `${snapshot.pe.toFixed(2)}x` : 'N/A'
    const pb = snapshot.pb != null ? `${snapshot.pb.toFixed(2)}x` : 'N/A'
    const divYield =
      snapshot.div_yield_pct != null
        ? `${(snapshot.div_yield_pct * 100).toFixed(2)}%`
        : 'N/A'
    const cap = snapshot.market_cap_raw ? fmtCap(snapshot.market_cap_raw) : 'N/A'
    const volStr = snapshot.volume != null ? fmtNum(snapshot.volume) : 'N/A'
    // TODO: beta — not in StockSnapshotRow; requires new column in stock_snapshots (schema change).
    // TODO: roe_pct, profit_margin_pct — not in StockSnapshotRow; requires schema change + market.ts fetch.
    // TODO: eps — not in StockSnapshotRow; requires schema change.
    // TODO: debt_to_equity — not in StockSnapshotRow; requires schema change.
    // TODO: avg_volume — removed from schema; was used to compare to current volume.
    //        Consider computing from historical snapshots if needed.

    fundamentalsBlock = `
FUNDAMENTALS:
- P/E: ${pe} | P/B: ${pb}
- Dividend Yield: ${divYield} | Market Cap: ${cap}
- Volume: ${volStr}`
  }

  // ── Technicals block (computed from our own snapshot history) ──
  let technicalsBlock = ''
  if (indicators) {
    const lines: string[] = []
    if (indicators.sma20 != null && price) {
      const vs20 = ((price - indicators.sma20) / indicators.sma20) * 100
      const sma50Str = indicators.sma50 != null ? ` | SMA50: ${fmtIdr(indicators.sma50)}` : ''
      lines.push(`- SMA20: ${fmtIdr(indicators.sma20)}${sma50Str} | Price vs SMA20: ${sign(vs20)}${vs20.toFixed(1)}%`)
    }
    if (indicators.rsi14 != null) {
      lines.push(`- RSI(14): ${indicators.rsi14.toFixed(0)} (${rsiLabel(indicators.rsi14)})`)
    }
    if (indicators.mom1wPct != null) {
      const rel = indicators.relStrength1wPct != null
        ? ` | vs IHSG 1W: ${sign(indicators.relStrength1wPct)}${indicators.relStrength1wPct.toFixed(1)}pp`
        : ''
      lines.push(`- 1W momentum: ${sign(indicators.mom1wPct)}${indicators.mom1wPct.toFixed(1)}%${rel}`)
    }
    if (indicators.volRatio20 != null) {
      lines.push(`- Volume vs 20d avg: ${indicators.volRatio20.toFixed(1)}x`)
    }
    if (lines.length > 0) technicalsBlock = `TECHNICALS (daily):\n${lines.join('\n')}`
  }

  // ── Trend block (use history snapshot if available) ──
  let trendBlock = ''
  if (history?.current_price && snapshot.current_price) {
    const weekChangePct = ((snapshot.current_price - history.current_price) / history.current_price) * 100
    trendBlock = `PRICE TREND:\n- 1W Change: ${sign(weekChangePct)}${weekChangePct.toFixed(2)}%`
  }

  // ── News sentiment block ──
  let newsBlock = ''
  if (newsSentiment) {
    newsBlock = `NEWS SENTIMENT:\n${newsSentiment}`
  }

  // ── Depth-dependent variables ──
  let wordLimit: number
  let extraInstructions: string
  if (depth === 'LIGHT') {
    wordLimit = 100
    extraInstructions = ''
  } else if (depth === 'DEEP') {
    wordLimit = 300
    extraInstructions =
      'Include a Sector Comparison section: how does this stock compare to sector peers?\n'
  } else {
    // FULL (default)
    wordLimit = 200
    extraInstructions = ''
  }

  if (newsSentiment) {
    extraInstructions +=
      'Factor news sentiment into your recommendation. If news contradicts technical/fundamental signals, flag the conflict.\n'
    // Sentiment now carries a numeric score header; force a decisive stance on
    // strongly bearish news instead of hiding behind a passive HOLD/MONITOR.
    extraInstructions += avgPrice
      ? 'If the sentiment score is strongly bearish (-3 or lower), do NOT default to a passive HOLD: choose CUT LOSS or TRIM, unless technicals/fundamentals clearly override the news — then justify the override explicitly.\n'
      : 'If the sentiment score is strongly bearish (-3 or lower), do NOT issue BUY; wait (MONITOR) or avoid (HOLD).\n'
  }

  // ── Position section ──
  let positionSection: string
  if (avgPrice) {
    positionSection =
      `<b>📍 Your Position</b>\n` +
      `${lots} lots | Bought: <code>Rp ${fmtNum(avgPrice, 2)}</code> → Now: <code>${fmtIdr(price)}</code>\n` +
      `P&L/share: <code>${fmtIdr(pnlPerShare)} (${sign(pnlPct)}${pnlPct.toFixed(2)}%)</code>\n` +
      `Total P&L: <code>Rp ${sign(totalPnl)}${fmtNum(totalPnl)}</code>\n` +
      `[1 sentence position context]`
  } else {
    positionSection =
      `<b>📍 Position</b>\n` +
      `Not currently held — evaluating ${ticker} as a potential entry at <code>${fmtIdr(price)}</code>.\n` +
      `[1 sentence on whether to initiate a position and at what level]`
  }

  // ── Action section — sizing rules only apply to a held position; watchlist
  //    tickers get a pure entry signal (no P&L threshold to suppress it) ──
  const actionSection = avgPrice
    ? `<b>⚡ Recommended Action</b>
[Concrete action for the held position: BUY / AVERAGE DOWN / HOLD / TRIM / TAKE PROFIT / CUT LOSS — 2-sentence reason + price level.
If total P&L is below Rp 1.000.000 note that the amount is not yet material, but still state your market view.]`
    : `<b>⚡ Entry Signal</b>
[BUY (enter now, with entry level) / MONITOR (wait — name the trigger you are waiting for) / HOLD (avoid for now — say why). 2 sentences max.]`

  const rekomendasiRule = avgPrice
    ? `REKOMENDASI: [exactly one word/phrase — BUY / AVERAGE DOWN / HOLD / TRIM / TAKE PROFIT / CUT LOSS / MONITOR. This is your market view on the stock, independent of position size.]`
    : `REKOMENDASI: [exactly one word — BUY / MONITOR / HOLD. Your entry verdict for this watchlist stock.]`

  // ── Stock header — include name/sector/industry when caller supplies metadata ──
  const nameStr = metadata?.name ? ` — ${metadata.name}` : ''
  const sectorStr =
    metadata?.sector && metadata?.industry
      ? `\nSector: ${metadata.sector} | ${metadata.industry}`
      : metadata?.sector
        ? `\nSector: ${metadata.sector}`
        : ''

  return `You are an IDX stock analyst helping a retail investor decide BUY/SELL/HOLD in real-time.

=== MARKET SESSION: ${session} ===

=== ${ticker}${nameStr} ===${sectorStr}

PRICE:
- Current  : ${fmtIdr(price)} (${arrow(snapshot.day_change_pct)} ${sign(dayPct)}${dayPct.toFixed(2)}%)
- Volume   : ${snapshot.volume != null ? fmtNum(snapshot.volume) : 'N/A'} lots
- 52W High : ${fmtIdr(snapshot.high_52w ?? 0)} | 52W Low: ${fmtIdr(snapshot.low_52w ?? 0)}
${pnlBlock}
${fundamentalsBlock}
${technicalsBlock}
${trendBlock}
${newsBlock}

FORMAT INSTRUCTIONS:
Write ONLY in Telegram HTML. Use ONLY tags: <b>, <i>, <code>.
Do NOT use Markdown (**, ##, -, *). Do NOT write \`\`\`html or \`\`\`.
Maximum ${wordLimit} words.
${extraInstructions}
REQUIRED FORMAT (fill in the bracketed sections):

<b>${ticker} ${arrow(snapshot.day_change_pct)} ${pnlStatus(pnlPct)}</b>
<i>${sign(dayPct)}${dayPct.toFixed(2)}% | ${session}</i>

${positionSection}

${actionSection}

<b>⚠️ Watch Out</b>
[1 specific risk today]

${rekomendasiRule}`
}
