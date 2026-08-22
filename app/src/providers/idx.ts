// app/src/providers/idx.ts
// IDX corporate-action dividend schedule via the official API, fetched through
// got-scraping (browser TLS + header impersonation) to pass Cloudflare.
import { gotScraping } from 'got-scraping'
import { CookieJar } from 'tough-cookie'
import { normalizeTicker } from '../../../lib/format'

const BASE = 'https://www.idx.co.id/primary/ListedCompany/GetCompanyProfilesDetail'

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

/** Upcoming/announced dividend events for a ticker; [] when none. */
export async function fetchDividendSchedule(ticker: string): Promise<DividendEvent[]> {
  const kode = normalizeTicker(ticker).replace(/\.JK$/i, '') // IDX wants the bare code
  const res = await gotScraping({
    url: `${BASE}?KodeEmiten=${encodeURIComponent(kode)}&language=id-id`,
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
    timeout: { request: 30_000 },
    retry: { limit: 2 },
  })
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
