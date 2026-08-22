// app/src/services/funds.ts
import {
  upsertFundCatalog, saveFundSnapshot, getFundPurchases,
  getHeldFundSlugs, replaceFundHoldings, getLatestFundNavs,
} from '../db/db'
import { fetchFundNavs, fetchFundHoldings } from '../providers/cermati'
import { foldWeightedAvg, type LedgerLot } from '../../../lib/ledger'
import type { FundPurchaseRow } from '../../../lib/types'

export interface FundHolding {
  fundCode: string
  fundName: string | null
  units: number            // net units (buys − sells)
  avgBuyNav: number
  cost: number
  currentNav: number | null
  currentValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
  realizedPnl: number
}

export async function refreshFundNavs(): Promise<void> {
  const navs = await fetchFundNavs()

  // Upsert catalog with classification + slug (columns already exist)
  await upsertFundCatalog(navs.map(n => ({
    code: n.fund_code,
    name: n.fund_name,
    slug: n.slug,
    fund_type: n.fund_type,
    category: n.category,
    investment_manager: n.investment_manager,
    currency: n.currency,
    active: true,
  })))

  // Save NAV snapshots + point-in-time metrics (idempotent on fund_code+nav_at).
  // A full catalog sweep is hundreds of rows — write them concurrently (pool
  // caps real parallelism) instead of one serial round-trip each.
  const writable = navs.filter((n): n is typeof n & { nav_at: string } => n.nav_at != null)
  await Promise.all(writable.map(n => saveFundSnapshot(n.fund_code, n.nav, n.nav_at, {
    aum: n.aum, expense_ratio: n.expense_ratio, cagr: n.cagr,
    ret_1m: n.ret_1m, ret_3m: n.ret_3m, ret_ytd: n.ret_ytd, ret_1y: n.ret_1y,
  })))
  const written = writable.length
  const newest = writable.reduce<string | null>((mx, n) => (mx == null || n.nav_at > mx ? n.nav_at : mx), null)
  // Log what actually landed, not what the provider returned: a sweep full of
  // null nav_at writes nothing while still reporting a healthy-looking count.
  if (written === 0) {
    console.warn(`[funds] no NAVs written (provider returned ${navs.length} rows)`)
    return
  }
  console.log(`[funds] refreshed ${written}/${navs.length} NAVs, newest nav_at ${newest}`)
}

/**
 * Sync portfolio composition for held funds only (bounded fan-out). Best-effort:
 * a fund with no slug or no listed compositions is skipped, never fatal.
 */
export async function refreshFundHoldings(): Promise<void> {
  const held = await getHeldFundSlugs()
  let synced = 0
  for (const { fund_code, slug } of held) {
    const holdings = await fetchFundHoldings(slug)
    if (holdings.length === 0) continue
    const asOf = holdings[0].as_of ?? new Date().toISOString().slice(0, 10)
    await replaceFundHoldings(fund_code, holdings.map(h => ({
      fund_code, label: h.label, ticker: h.ticker,
      percentage: h.percentage, as_of: h.as_of ?? asOf,
    })))
    synced++
  }
  console.log(`[funds] synced holdings for ${synced}/${held.length} held funds`)
}

export async function listFundHoldings(): Promise<FundHolding[]> {
  const purchases = await getFundPurchases()
  if (purchases.length === 0) return []

  const latestNavs = await getLatestFundNavs()
  const navMap: Record<string, number> = {}
  for (const row of latestNavs) if (row.nav != null) navMap[row.fund_code] = row.nav

  // foldWeightedAvg needs chronological order; DB returns newest-first
  const sortedPurchases = [...purchases].sort((a, b) =>
    (a.purchased_at ?? '').localeCompare(b.purchased_at ?? '') || ((a.id ?? 0) - (b.id ?? 0)))

  const byFund = new Map<string, FundPurchaseRow[]>()
  for (const p of sortedPurchases) {
    const rows = byFund.get(p.fund_code) ?? []
    rows.push(p)
    byFund.set(p.fund_code, rows)
  }

  return [...byFund.entries()].map(([fundCode, rows]) => {
    const lots: LedgerLot[] = rows.map(p => ({
      side: p.side ?? 'BUY', qty: p.units, price: p.buy_nav_per_unit, at: p.purchased_at,
    }))
    const f = foldWeightedAvg(lots)
    const currentNav = navMap[fundCode] ?? null
    const currentValue = currentNav != null ? f.netQty * currentNav : null
    const unrealizedPnl = currentValue != null ? currentValue - f.totalBuyCost : null
    const unrealizedPnlPct = unrealizedPnl != null && f.totalBuyCost > 0
      ? (unrealizedPnl / f.totalBuyCost) * 100
      : null
    return {
      fundCode,
      fundName: rows[0].fund_name ?? null,
      units: f.netQty,
      avgBuyNav: f.avgBuy,
      cost: f.totalBuyCost,
      currentNav,
      currentValue,
      unrealizedPnl,
      unrealizedPnlPct,
      realizedPnl: f.realizedPnl,
    }
  }).filter(h => h.units > 1e-9 || h.realizedPnl !== 0)
}
