export const WIB = 'Asia/Jakarta'

export function safeFloat(val: unknown, decimals = 2): number | null {
  const n = Number(val)
  if (val === null || val === undefined || isNaN(n)) return null
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}

export function fmtIdr(val: number, decimals = 0): string {
  // Non-finite (NaN/Infinity from a bad upstream calc) is surfaced, not masked
  // as 'Rp 0'; a genuinely missing value (null/undefined) still reads 'Rp 0'.
  if (!Number.isFinite(val)) return val == null ? 'Rp 0' : 'Rp —'
  return 'Rp ' + val.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtCap(val: number): string {
  if (!val) return 'Rp 0'
  if (val >= 1e12) return `Rp ${(val / 1e12).toFixed(2).replace('.', ',')}T`
  if (val >= 1e9)  return `Rp ${(val / 1e9).toFixed(2).replace('.', ',')}B`
  if (val >= 1e6)  return `Rp ${(val / 1e6).toFixed(2).replace('.', ',')}M`
  return fmtIdr(val)
}

export function calcPnl(
  currentPrice: number,
  avgPrice: number,
  lots: number,
): { pnl: number; pnlPct: number; totalPnl: number; invested: number } {
  const shares = lots * 100
  const invested = avgPrice * shares
  const pnl = currentPrice - avgPrice
  const totalPnl = pnl * shares
  const pnlPct = avgPrice > 0 ? (pnl / avgPrice) * 100 : 0
  return { pnl, pnlPct, totalPnl, invested }
}

export function pnlIcon(pct: number): string {
  if (pct > 0)   return '🟢 PROFIT'
  if (pct === 0) return '⚪ BREAKEVEN'
  if (pct > -5)  return '🟡 SMALL LOSS'
  return '🔴 LOSS'
}

export function normalizeTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase()
  if (t === 'IHSG') return '^JKSE'
  if (t.startsWith('^') || t.endsWith('.JK')) return t
  return `${t}.JK`
}

/** Display form of a stored yahoo symbol: strip the .JK suffix, ^JKSE → IHSG. */
export function displayTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase()
  if (t === '^JKSE') return 'IHSG'
  return t.replace(/\.JK$/, '')
}

export function fmtWib(dt: Date | string): string {
  const d = typeof dt === 'string' ? new Date(dt) : dt
  return d.toLocaleString('id-ID', {
    timeZone: WIB,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── WIB DATE ──
/** WIB (Asia/Jakarta) calendar date offset by `days`, as YYYY-MM-DD. */
export function wibDateOffset(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: WIB })
}

const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a', 'br'])

export function sanitizeHtml(html: string): string {
  let result = html
  // First, remove disallowed tags with their content
  result = result.replace(/<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*?<\/\1>/gi, (match, tag: string) => {
    return ALLOWED_TAGS.has(tag.toLowerCase()) ? match : ''
  })
  // Then, remove any remaining disallowed tags (self-closing, br, etc.)
  result = result.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
    return ALLOWED_TAGS.has(tag.toLowerCase()) ? match : ''
  })
  return result
}

export function valueHolding(
  qty: number,
  buyPrice: number,
  currentPrice: number,
): { cost: number; currentValue: number; pnl: number; pnlPct: number; statusEmoji: string } {
  const cost = qty * buyPrice
  const currentValue = qty * currentPrice
  const pnl = currentValue - cost
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
  return { cost, currentValue, pnl, pnlPct, statusEmoji: pnlIcon(pnlPct) }
}
