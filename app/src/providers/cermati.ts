/**
 * Cermati provider — gold price (GraphQL) + mutual-fund NAV (REST).
 *
 * Gold:  POSTs GetGoldPrice query to CERMATI_GRAPHQL_URL (default: edge.cermati.com/graphql).
 * Funds: Paginates CERMATI_MF_URL until a page comes back with fewer items than the page size.
 *
 * Both functions never throw on network/parse errors — they return empty results and log.
 */
import 'dotenv/config'
import { withRetry } from '../utils/retry'

// ── GOLD ──────────────────────────────────────────────────────────────────────

const GOLD_DEFAULT_URL = 'https://edge.cermati.com/graphql'
const GOLD_VENUE = 'cermati'

/** GraphQL query for gold price (verified 2026-06-18). */
const GOLD_QUERY =
  'query GetGoldPrice($criteria: GetGoldPrice_Criteria) {\n' +
  '  getGoldPrice(criteria: $criteria) {\n' +
  '    ... on GetGoldPrice_Response {\n' +
  '      current { buyPrice sellPrice midPrice priceAt __typename }\n' +
  '      __typename\n' +
  '    }\n' +
  '    ... on InternalServerError {\n' +
  '      errorCode errorMessage isError errorName __typename\n' +
  '    }\n' +
  '    __typename\n' +
  '  }\n' +
  '}\n'

interface GoldCurrent {
  buyPrice?: number
  sellPrice?: number
  midPrice?: number
  priceAt?: string
  __typename?: string
}

interface GoldProductNode {
  __typename?: string
  current?: GoldCurrent
  errorCode?: string
  errorMessage?: string
}

interface GoldGraphQLResponse {
  data?: {
    getGoldPrice?: GoldProductNode
  }
}

export interface GoldPriceResult {
  buy: number
  sell: number
  mid: number | null
  priceAt: string | null
}

/**
 * Fetches the Cermati gold prices (buy + sell).
 * Returns a map of `{ cermati: { buy, sell, mid, priceAt } }`, or `{}` on failure.
 */
export async function fetchGoldPrices(): Promise<Record<string, GoldPriceResult>> {
  const url = process.env.CERMATI_GRAPHQL_URL ?? GOLD_DEFAULT_URL

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'client': 'WEB_BROWSER',
    'origin': 'https://www.cermati.com',
    'referer': 'https://www.cermati.com/',
  }
  const cookie = process.env.CERMATI_COOKIE
  if (cookie) headers['cookie'] = cookie

  let res: Response
  try {
    res = await withRetry(() =>
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationName: 'GetGoldPrice',
          variables: {},
          query: GOLD_QUERY,
        }),
        signal: AbortSignal.timeout(15_000),
      }),
      3, 500,
    )
  } catch (err) {
    console.warn(`[cermati] gold fetch failed: ${err}`)
    return {}
  }

  if (!res.ok) {
    console.warn(`[cermati] gold: HTTP ${res.status}`)
    return {}
  }

  let json: GoldGraphQLResponse
  try {
    json = (await res.json()) as GoldGraphQLResponse
  } catch (err) {
    console.warn(`[cermati] gold: invalid JSON — ${err}`)
    return {}
  }

  const node = json?.data?.getGoldPrice
  if (!node || node.__typename !== 'GetGoldPrice_Response') {
    console.warn('[cermati] gold: unexpected response shape', JSON.stringify(node))
    return {}
  }

  const cur = node.current
  const sell = Number(cur?.sellPrice ?? 0)
  const buy = Number(cur?.buyPrice ?? 0)
  if (!sell) {
    console.warn('[cermati] gold: sellPrice missing or zero')
    return {}
  }

  return {
    [GOLD_VENUE]: {
      buy: buy || sell,
      sell,
      mid: cur?.midPrice != null ? Number(cur.midPrice) : null,
      priceAt: cur?.priceAt ?? null,
    },
  }
}

// ── FUNDS ─────────────────────────────────────────────────────────────────────

const FUND_DEFAULT_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'
const FUND_PAGE_SIZE = 100
const FUND_MAX_PAGES = 50

export interface FundRecord {
  fund_code: string
  slug: string | null
  fund_name: string
  nav: number
  nav_at: string | null
  // Catalog classification (static-ish)
  fund_type: string | null
  category: string | null
  investment_manager: string | null
  currency: string
  // Point-in-time market metrics
  aum: number | null
  expense_ratio: number | null
  cagr: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_ytd: number | null
  ret_1y: number | null
}

interface FundItem {
  code?: string
  slug?: string
  name?: string
  currentNav?: number
  lastUpdatedNav?: string
  type?: string
  category?: string
  currency?: string
  expenseRatio?: number
  currentAum?: number
  assetUnderManagement?: { amount?: number }
  investmentManager?: { name?: string }
  compoundAnnualGrowthRate?: Record<string, { cagr?: number | null }> | null
  oneMonthNav?: number
  threeMonthNav?: number
  yearToDateNav?: number
  oneYearNav?: number
  [key: string]: unknown
}

interface FundPageResponse {
  data?: FundItem[]
}

/** Best-horizon CAGR as a percent: prefer since-inception → 5Y → 3Y → 1Y. */
function pickCagr(c: FundItem['compoundAnnualGrowthRate']): number | null {
  if (!c) return null
  for (const key of ['all', '5Year', '3Year', '1Year']) {
    const v = c[key]?.cagr
    if (v != null) return v * 100
  }
  return null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Paginates the Cermati mutual-fund catalog and returns NAV records.
 * Pagination is 0-indexed. Stops when a page returns fewer items than page size.
 * Returns `[]` on failure.
 */
export async function fetchFundNavs(): Promise<FundRecord[]> {
  const base = process.env.CERMATI_MF_URL ?? FUND_DEFAULT_URL
  const results: FundRecord[] = []

  const headers: Record<string, string> = {
    'accept': '*/*',
    'referer': 'https://invest.cermati.com/reksadana/semua',
    'user-agent':
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  }
  const cookie = process.env.CERMATI_COOKIE
  if (cookie) headers['cookie'] = cookie

  for (let page = 0; page < FUND_MAX_PAGES; page++) {
    const url =
      `${base}?page=${page}&size=${FUND_PAGE_SIZE}&status=active_subsenabled`

    let res: Response
    try {
      res = await withRetry(() =>
        fetch(url, {
          headers,
          signal: AbortSignal.timeout(15_000),
        }),
        3, 500,
      )
    } catch (err) {
      console.warn(`[cermati] funds fetch failed on page ${page}: ${err}`)
      break
    }

    if (!res.ok) {
      console.warn(`[cermati] funds: HTTP ${res.status} on page ${page}`)
      break
    }

    let json: FundPageResponse
    try {
      json = (await res.json()) as FundPageResponse
    } catch (err) {
      console.warn(`[cermati] funds: invalid JSON on page ${page} — ${err}`)
      break
    }

    const batch = json?.data ?? []
    for (const item of batch) {
      if (!item.code) continue
      const rawDate = item.lastUpdatedNav
      results.push({
        fund_code: item.code,
        slug: item.slug ?? null,
        fund_name: item.name ?? item.code,
        nav: Number(item.currentNav ?? 0),
        nav_at: typeof rawDate === 'string' ? rawDate.slice(0, 10) : null,
        fund_type: item.type ?? null,
        category: item.category ?? null,
        investment_manager: item.investmentManager?.name ?? null,
        currency: (item.currency ?? 'IDR').toUpperCase(),
        aum: num(item.currentAum) ?? num(item.assetUnderManagement?.amount),
        expense_ratio: num(item.expenseRatio),
        cagr: pickCagr(item.compoundAnnualGrowthRate),
        ret_1m: num(item.oneMonthNav),
        ret_3m: num(item.threeMonthNav),
        ret_ytd: num(item.yearToDateNav),
        ret_1y: num(item.oneYearNav),
      })
    }

    if (batch.length < FUND_PAGE_SIZE) break
  }

  return results
}

// ── FUND HOLDINGS (per-fund portfolio composition) ──────────────────────────
const FUND_DETAIL_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products/s'

export interface FundHoldingRecord {
  label: string
  ticker: string | null
  percentage: number | null
  as_of: string | null
}

interface DetailComposition {
  name?: string
  code?: string | null
  allocationPercentage?: number
}
interface FundDetailResponse {
  success?: boolean
  data?: {
    fundPortfolioCompositions?: Array<{ portfolioAt?: string; compositions?: DetailComposition[] }>
  }
}

/**
 * Portfolio composition for one fund from Cermati's detail endpoint
 * (/products/s/{slug} → fundPortfolioCompositions[0]). Returns `[]` on any
 * failure — holdings are best-effort enrichment, never fatal to a refresh.
 */
export async function fetchFundHoldings(slug: string): Promise<FundHoldingRecord[]> {
  const headers: Record<string, string> = {
    'accept': '*/*',
    'referer': 'https://invest.cermati.com/reksadana/semua',
    'user-agent':
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  }
  const cookie = process.env.CERMATI_COOKIE
  if (cookie) headers['cookie'] = cookie

  try {
    const res = await withRetry(() =>
      fetch(`${FUND_DETAIL_URL}/${encodeURIComponent(slug)}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      }),
      3, 500,
    )
    if (!res.ok) {
      console.warn(`[cermati] fund detail: HTTP ${res.status} for ${slug}`)
      return []
    }
    const json = (await res.json()) as FundDetailResponse
    const block = json?.data?.fundPortfolioCompositions?.[0]
    const asOf = typeof block?.portfolioAt === 'string' ? block.portfolioAt.slice(0, 10) : null
    return (block?.compositions ?? []).map(c => ({
      label: c.name ?? 'Unknown',
      ticker: c.code ?? null,
      percentage: num(c.allocationPercentage),
      as_of: asOf,
    }))
  } catch (err) {
    console.warn(`[cermati] fund holdings fetch failed for ${slug}: ${err}`)
    return []
  }
}
