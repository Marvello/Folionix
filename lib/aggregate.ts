// Portfolio-wide aggregation shared by web (dashboard) and app (week review).
// Pure functions: rows in, numbers out — no Supabase client, no env access.
// Extracted verbatim from web/app/page.tsx so both sides compute identical
// net-worth / capital / income / return figures.
//
// Repo-root copy — web/lib/aggregate.ts duplicates this verbatim (web is
// isolated from repo-root lib/); imports differ only in the .js extension.
// Keep in sync manually, like lib/ledger.ts.

import { calcPnl } from './format'
import { foldWeightedAvg, type LedgerLot } from './ledger'

// Minimal structural row shapes — supersets (full Supabase row types) are accepted.
export interface AggPosition {
  ticker: string
  avg_price: number | null
  lots: number | null
  realized_pnl?: number | null
}
export interface AggSnapshot {
  ticker: string
  current_price: number | null
}
export interface AggGoldPurchase {
  id?: number
  venue: string
  grams: number
  buy_price_per_gram: number
  purchased_at: string
  side?: 'BUY' | 'SELL'
}
export interface AggGoldPrice {
  venue: string
  sell_price: number | null
}
export interface AggBondHolding {
  principal: number
  purchase_price: number | null
}
export interface AggFundPurchase {
  id?: number
  fund_code: string
  units: number
  buy_nav_per_unit: number
  currency?: string
  purchased_at: string
  side?: 'BUY' | 'SELL'
}
export interface AggFundNav {
  fund_code: string
  nav: number | null
}
export interface AmountRow {
  amount: number | null
}

export interface AggregateInput {
  positions: AggPosition[]
  snapshots: AggSnapshot[]
  goldPurchases: AggGoldPurchase[]
  goldPrices: AggGoldPrice[]
  bonds: AggBondHolding[]
  bondPayments: AmountRow[]
  fundPurchases: AggFundPurchase[]
  fundNavs: AggFundNav[]
  /** base currency (e.g. "USD") → IDR rate */
  fxToIdr: Map<string, number>
  stockDividends: AmountRow[]
  fundDistributions: AmountRow[]
  accountCharges: AmountRow[]
}

export interface ProductSummary {
  name: 'Stocks' | 'Gold' | 'Bonds' | 'Funds'
  value: number
  cost: number
  pnl: number
  income: number
}

export interface PortfolioAggregate {
  totalInvested: number
  stockPnl: number
  stockRealized: number
  stockValue: number
  goldCost: number
  goldValue: number
  goldPnl: number
  goldRealized: number
  bondValue: number
  bondCost: number
  bondPnl: number
  bondCoupons: number
  fundCost: number
  fundValue: number
  fundPnl: number
  fundRealized: number
  netWorth: number
  combinedPnl: number
  stockDivTotal: number
  fundDistTotal: number
  totalIncome: number
  totalRealized: number
  totalCapital: number
  totalCharges: number
  totalReturn: number
  products: ProductSummary[]
  totalProductCost: number
}

const sumAmounts = (rows: AmountRow[]): number =>
  rows.reduce((acc, r) => acc + (r.amount ?? 0), 0)

export function aggregatePortfolio(input: AggregateInput): PortfolioAggregate {
  const snapBy = new Map(input.snapshots.map((s) => [s.ticker.toUpperCase(), s]))

  let totalInvested = 0
  let stockPnl = 0
  let stockRealized = 0
  for (const p of input.positions) {
    const avg = p.avg_price ?? 0
    const lots = p.lots ?? 0
    totalInvested += avg * lots * 100
    const cur = snapBy.get(p.ticker.toUpperCase())?.current_price ?? 0
    if (cur && avg) stockPnl += calcPnl(cur, avg, lots).totalPnl
    stockRealized += p.realized_pnl ?? 0
  }
  const stockValue = totalInvested + stockPnl

  // Gold: net buys−sells per venue via weighted-avg fold, then value at venue sell price.
  const goldSellByVenue = new Map(input.goldPrices.map((g) => [g.venue, g.sell_price]))
  const goldByVenue = new Map<string, AggGoldPurchase[]>()
  for (const g of input.goldPurchases) {
    const list = goldByVenue.get(g.venue) ?? []
    list.push(g)
    goldByVenue.set(g.venue, list)
  }
  let goldCost = 0 // cost basis of priced purchases only (P&L denominator)
  let goldValue = 0
  let goldRealized = 0
  for (const [venue, rows] of goldByVenue) {
    const sorted = [...rows].sort(
      (a, b) => a.purchased_at.localeCompare(b.purchased_at) || (a.id ?? 0) - (b.id ?? 0),
    )
    const lots: LedgerLot[] = sorted.map((g) => ({
      side: g.side ?? 'BUY',
      qty: g.grams,
      price: g.buy_price_per_gram,
      at: g.purchased_at,
    }))
    const f = foldWeightedAvg(lots)
    const sell = goldSellByVenue.get(venue) ?? null
    if (sell != null) {
      goldCost += f.totalBuyCost
      goldValue += f.netQty * sell
    }
    goldRealized += f.realizedPnl
  }
  const goldPnl = goldValue - goldCost

  // Bonds: valued at par (principal); P&L = principal - purchase_price if provided
  let bondValue = 0
  let bondCost = 0
  for (const b of input.bonds) {
    bondValue += b.principal || 0
    bondCost += b.purchase_price != null ? b.purchase_price : b.principal || 0
  }
  const bondPnl = bondValue - bondCost
  const bondCoupons = sumAmounts(input.bondPayments)

  // Funds: net buys−sells per fund_code via weighted-avg fold; convert non-IDR
  // holdings to IDR via forex rates where available.
  const navByCode = new Map(input.fundNavs.map((n) => [n.fund_code, n.nav]))
  const fundByCode = new Map<string, AggFundPurchase[]>()
  for (const f of input.fundPurchases) {
    const list = fundByCode.get(f.fund_code) ?? []
    list.push(f)
    fundByCode.set(f.fund_code, list)
  }
  let fundCost = 0
  let fundValue = 0
  let fundRealized = 0
  for (const [code, rows] of fundByCode) {
    const sorted = [...rows].sort(
      (a, b) => a.purchased_at.localeCompare(b.purchased_at) || (a.id ?? 0) - (b.id ?? 0),
    )
    const currency = sorted[0]?.currency || 'IDR'
    const fx = currency === 'IDR' ? 1 : (input.fxToIdr.get(currency) ?? null)
    if (fx == null) continue // no rate available — exclude to avoid misleading totals
    const lots: LedgerLot[] = sorted.map((f) => ({
      side: f.side ?? 'BUY',
      qty: f.units,
      price: f.buy_nav_per_unit,
      at: f.purchased_at,
    }))
    const f = foldWeightedAvg(lots)
    const nav = navByCode.get(code) ?? null
    if (nav != null) {
      fundCost += f.totalBuyCost * fx
      fundValue += f.netQty * nav * fx
    }
    fundRealized += f.realizedPnl * fx
  }
  const fundPnl = fundValue - fundCost

  const netWorth = stockValue + goldValue + bondValue + fundValue
  const combinedPnl = stockPnl + goldPnl + bondPnl + fundPnl

  // Income: dividends + fund distributions + bond coupons received.
  const stockDivTotal = sumAmounts(input.stockDividends)
  const fundDistTotal = sumAmounts(input.fundDistributions)
  const totalIncome = stockDivTotal + fundDistTotal + bondCoupons

  // Capital: unrealized (mark-to-market) + realized P&L across stocks/gold/funds.
  const totalRealized = stockRealized + goldRealized + fundRealized
  const totalCapital = combinedPnl + totalRealized

  const totalCharges = sumAmounts(input.accountCharges)
  const totalReturn = totalCapital + totalIncome - totalCharges

  const products: ProductSummary[] = [
    { name: 'Stocks', value: stockValue, cost: totalInvested, pnl: stockPnl, income: stockDivTotal },
    { name: 'Gold', value: goldValue, cost: goldCost, pnl: goldPnl, income: 0 },
    { name: 'Bonds', value: bondValue, cost: bondCost, pnl: bondPnl, income: bondCoupons },
    { name: 'Funds', value: fundValue, cost: fundCost, pnl: fundPnl, income: fundDistTotal },
  ]
  const totalProductCost = totalInvested + goldCost + bondCost + fundCost

  return {
    totalInvested, stockPnl, stockRealized, stockValue,
    goldCost, goldValue, goldPnl, goldRealized,
    bondValue, bondCost, bondPnl, bondCoupons,
    fundCost, fundValue, fundPnl, fundRealized,
    netWorth, combinedPnl,
    stockDivTotal, fundDistTotal, totalIncome,
    totalRealized, totalCapital, totalCharges, totalReturn,
    products, totalProductCost,
  }
}
