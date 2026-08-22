/**
 * KSEI bond coupon schedule scraper.
 *
 * Fetches distribution dates for a bond series from the KSEI registered-securities
 * HTML pages. The KSEI site does NOT expose a JSON API for coupon schedules —
 * the data lives in HTML tables, so this module does lightweight regex-based
 * HTML parsing.
 *
 * Endpoints:
 *   Government bonds: {KSEI_BASE_URL}/government-bonds/lc/{series}
 *   Corporate bonds:  {KSEI_BASE_URL}/corporate-bonds/lc/{series}
 *
 * The page's tbody contains one row per corporate-action entry. Rows where the
 * first column is "interest" or "bunga" are coupon distributions; other types
 * (e.g., "redemption") are skipped. The distribution date is encoded as
 * <span class="hidden">YYYYMMDD</span> in column 5 (0-indexed: col 4).
 *
 * KSEI HTML does not include the per-unit coupon amount — amount_per_unit is
 * always null in the returned records.
 *
 * Returns an empty array on any error (network, HTTP, parse). Never throws.
 */
import 'dotenv/config'
import { withRetry } from '../utils/retry'

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const DEFAULT_BASE = 'https://web.ksei.co.id/services/registered-securities'

/** Series type prefixes that resolve to government-bonds on KSEI. */
const GOV_TYPES = new Set(['SR', 'ORI', 'SBR', 'ST'])

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

// ── REGEX HELPERS ─────────────────────────────────────────────────────────────

// Matches the hidden span KSEI uses for sortable dates: <span class="hidden">20260817</span>
const DATE_RE = /<span[^>]*class="hidden"[^>]*>(\d{8})<\/span>/

// Extracts tbody content (DOTALL)
const TBODY_RE = /<tbody>([\s\S]*?)<\/tbody>/i

// Splits on <tr> rows
const TR_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi

// Extracts <td> cell content
const TD_RE = /<td[^>]*>([\s\S]*?)<\/td>/gi

// Strips all HTML tags
const TAG_RE = /<[^>]+>/g

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface CouponScheduleEntry {
  /** ISO 8601 date string (YYYY-MM-DD) for the distribution date. */
  payment_date: string
  /**
   * Per-unit coupon amount in IDR.
   * Always null because KSEI HTML pages do not include this value.
   */
  amount_per_unit: number | null
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function seriesKind(series: string): 'government-bonds' | 'corporate-bonds' {
  const prefix = series.slice(0, 3).toUpperCase()
  // Try 2-letter prefix first (ORI, SBR), then 2-char (SR, ST)
  if (GOV_TYPES.has(prefix) || GOV_TYPES.has(series.slice(0, 2).toUpperCase())) {
    return 'government-bonds'
  }
  return 'corporate-bonds'
}

function buildUrl(series: string): string {
  const base = (process.env.KSEI_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '')
  const kind = seriesKind(series)
  return `${base}/${kind}/lc/${encodeURIComponent(series)}`
}

function stripTags(html: string): string {
  return html.replace(TAG_RE, '').trim()
}

/** Parse YYYYMMDD raw string from KSEI hidden span into ISO 8601 date. */
function parseDate(raw: string): string | null {
  if (raw.length !== 8) return null
  const year = raw.slice(0, 4)
  const month = raw.slice(4, 6)
  const day = raw.slice(6, 8)
  // Basic sanity check
  const y = Number(year), m = Number(month), d = Number(day)
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${year}-${month}-${day}`
}

/** Extract all <td> inner-HTML values from a <tr> inner-HTML string. */
function extractCells(trInner: string): string[] {
  const cells: string[] = []
  const re = new RegExp(TD_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(trInner)) !== null) {
    cells.push(m[1])
  }
  return cells
}

/** Parse the HTML body and return coupon distribution rows. */
function parseKseiHtml(html: string): CouponScheduleEntry[] {
  const tbodyMatch = TBODY_RE.exec(html)
  if (!tbodyMatch) return []

  const tbodyContent = tbodyMatch[1]
  const results: CouponScheduleEntry[] = []

  const trRe = new RegExp(TR_RE.source, 'gi')
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRe.exec(tbodyContent)) !== null) {
    const cells = extractCells(trMatch[1])
    if (cells.length < 5) continue

    // Column 0: corporate-action type — only process interest/coupon rows
    const caType = stripTags(cells[0]).toLowerCase()
    if (caType !== 'interest' && caType !== 'bunga') continue

    // Column 4: distribution date cell (contains hidden span)
    const dateMatch = DATE_RE.exec(cells[4])
    if (!dateMatch) continue

    const isoDate = parseDate(dateMatch[1])
    if (!isoDate) continue

    results.push({
      payment_date: isoDate,
      amount_per_unit: null, // KSEI HTML does not expose per-unit amounts
    })
  }

  return results
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Fetch the coupon/distribution schedule for a bond series from KSEI.
 *
 * @param series - Bond series code, e.g. "SR020", "ORI025", "SOME_CORP".
 * @returns Array of schedule entries, or empty array on any error.
 */
export async function fetchCouponSchedule(series: string): Promise<CouponScheduleEntry[]> {
  const url = buildUrl(series)
  try {
    return await withRetry(async () => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: FETCH_HEADERS,
      })
      if (!res.ok) throw new Error(`KSEI ${res.status}`)
      const html = await res.text()
      return parseKseiHtml(html)
    }, 3, 1000)
  } catch {
    return []
  }
}
