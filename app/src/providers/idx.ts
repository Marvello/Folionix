// app/src/providers/idx.ts
// IDX website API (dividend schedule, IDX-IC classification), fetched through
// got-scraping (browser TLS + header impersonation) to pass Cloudflare. Only the
// /primary/... endpoints pass; /support/... (e.g. the stock screener) sits behind
// a JS challenge.
import { gotScraping } from 'got-scraping'
import { CookieJar } from 'tough-cookie'
import { normalizeTicker } from '../../../lib/format'

const BASE = 'https://www.idx.co.id/primary/ListedCompany/GetCompanyProfilesDetail'
const PROFILES = 'https://www.idx.co.id/primary/ListedCompany/GetCompanyProfiles'

// One session for the process lifetime: the jar carries Cloudflare clearance
// cookies forward, and the token keeps got-scraping's generated fingerprint
// consistent — so only the first request faces a challenge.
const cookieJar = new CookieJar()
const sessionToken = {}

export interface DividendEvent {
  cum_date: string | null
  ex_date: string
  recording_date: string | null
  pay_date: string | null
  amount_per_share: number | null
  currency: string | null
}

/** Slice an IDX datetime string (e.g. "2026-07-03T16:15:00") to YYYY-MM-DD, or null. */
function toDate(v: unknown): string | null {
  if (typeof v !== 'string' || v.length < 10) return null
  const d = v.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/** GET an IDX /primary endpoint with the shared Cloudflare-passing session. */
function idxGet(url: string) {
  return gotScraping({
    url,
    useHeaderGenerator: true,
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 120 }],
      operatingSystems: ['macos', 'windows'],
      devices: ['desktop'],
      locales: ['en-US'],
    },
    http2: true,
    cookieJar,
    sessionToken,
    headers: { Referer: 'https://www.idx.co.id/' },
    timeout: { request: 60_000 },
    retry: { limit: 2 },
  })
}

/** Upcoming/announced dividend events for a ticker; [] when none. */
export async function fetchDividendSchedule(ticker: string): Promise<DividendEvent[]> {
  const kode = normalizeTicker(ticker).replace(/\.JK$/i, '') // IDX wants the bare code
  const res = await idxGet(`${BASE}?KodeEmiten=${encodeURIComponent(kode)}&language=id-id`)
  if (res.statusCode !== 200) throw new Error(`IDX dividend fetch ${kode}: HTTP ${res.statusCode}`)

  let data: { Dividen?: Array<Record<string, unknown>> }
  try { data = JSON.parse(res.body) } catch { throw new Error(`IDX dividend parse ${kode}`) }

  const rows = Array.isArray(data.Dividen) ? data.Dividen : []
  const events: DividendEvent[] = []
  for (const r of rows) {
    const ex = toDate(r.TanggalExRegulerDanNegosiasi)
    if (!ex) continue
    const amt = typeof r.CashDividenPerSaham === 'number' ? r.CashDividenPerSaham : null
    events.push({
      cum_date: toDate(r.TanggalCum),
      ex_date: ex,
      recording_date: toDate(r.TanggalDPS),
      pay_date: toDate(r.TanggalPembayaran),
      amount_per_share: amt,
      currency: typeof r.CashDividenPerSahamMU === 'string' && r.CashDividenPerSahamMU ? r.CashDividenPerSahamMU : null,
    })
  }
  return events
}

// ── IDX-IC CLASSIFICATION ──

export interface Classification {
  ticker: string          // yahoo symbol (KODE.JK)
  name: string | null
  sector: string | null
  sub_sector: string | null
  industry: string | null
  sub_industry: string | null
  board: string | null
  listed_at: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Pure mapping of one GetCompanyProfiles row. Exported for tests. */
export function mapClassification(r: Record<string, unknown>): Classification | null {
  const kode = str(r.KodeEmiten)
  if (!kode) return null
  return {
    ticker: normalizeTicker(kode),
    name: str(r.NamaEmiten),
    sector: str(r.Sektor),
    sub_sector: str(r.SubSektor),
    industry: str(r.Industri),
    sub_industry: str(r.SubIndustri),
    board: str(r.PapanPencatatan),
    listed_at: toDate(r.TanggalPencatatan),
  }
}

/** Every listed stock with its IDX-IC sector/industry (~960 rows, one request). */
export async function fetchClassifications(): Promise<Classification[]> {
  const res = await idxGet(`${PROFILES}?emitenType=s&start=0&length=9999`)
  if (res.statusCode !== 200) throw new Error(`IDX classification fetch: HTTP ${res.statusCode}`)
  let data: { data?: Array<Record<string, unknown>> }
  try { data = JSON.parse(res.body) } catch { throw new Error('IDX classification parse') }
  const rows = (data.data ?? []).map(mapClassification).filter((c): c is Classification => c !== null)
  // A short list means a truncated/changed response — never let it shrink the table.
  if (rows.length < 500) throw new Error(`IDX classification: only ${rows.length} rows`)
  return rows
}
