import { describe, it, expect } from 'vitest'
import { aggregatePortfolio, type AggregateInput } from './aggregate'

const emptyInput = (): AggregateInput => ({
  positions: [],
  snapshots: [],
  goldPurchases: [],
  goldPrices: [],
  bonds: [],
  bondPayments: [],
  fundPurchases: [],
  fundNavs: [],
  fxToIdr: new Map(),
  stockDividends: [],
  fundDistributions: [],
  accountCharges: [],
})

describe('aggregatePortfolio', () => {
  it('returns zeros for empty portfolio', () => {
    const agg = aggregatePortfolio(emptyInput())
    expect(agg.netWorth).toBe(0)
    expect(agg.combinedPnl).toBe(0)
    expect(agg.totalReturn).toBe(0)
    expect(agg.products).toHaveLength(4)
  })

  it('computes stock invested, pnl and value', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      positions: [{ ticker: 'BBCA', avg_price: 9000, lots: 2, realized_pnl: 50_000 }],
      snapshots: [{ ticker: 'bbca', current_price: 9500 }],
    })
    // 2 lots = 200 shares
    expect(agg.totalInvested).toBe(9000 * 200)
    expect(agg.stockPnl).toBe(500 * 200)
    expect(agg.stockValue).toBe(9500 * 200)
    expect(agg.stockRealized).toBe(50_000)
    expect(agg.netWorth).toBe(9500 * 200)
  })

  it('ignores stock pnl when no snapshot price', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      positions: [{ ticker: 'TLKM', avg_price: 3000, lots: 1 }],
    })
    expect(agg.totalInvested).toBe(300_000)
    expect(agg.stockPnl).toBe(0)
    expect(agg.stockValue).toBe(300_000)
  })

  it('values gold at venue sell price, nets buys minus sells', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      goldPurchases: [
        { id: 1, venue: 'treasury', grams: 10, buy_price_per_gram: 1_000_000, purchased_at: '2026-01-01' },
        { id: 2, venue: 'treasury', grams: 4, buy_price_per_gram: 1_200_000, purchased_at: '2026-02-01', side: 'SELL' },
      ],
      goldPrices: [{ venue: 'treasury', sell_price: 1_300_000 }],
    })
    // net 6g @ avg 1,000,000 → cost 6,000,000; value 6 × 1,300,000
    expect(agg.goldCost).toBe(6_000_000)
    expect(agg.goldValue).toBe(7_800_000)
    expect(agg.goldPnl).toBe(1_800_000)
    expect(agg.goldRealized).toBe(4 * 200_000)
  })

  it('excludes gold venue without a sell price from value but keeps realized', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      goldPurchases: [
        { id: 1, venue: 'pluang', grams: 5, buy_price_per_gram: 1_000_000, purchased_at: '2026-01-01' },
      ],
      goldPrices: [],
    })
    expect(agg.goldCost).toBe(0)
    expect(agg.goldValue).toBe(0)
  })

  it('values bonds at par with purchase-price pnl', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      bonds: [
        { principal: 10_000_000, purchase_price: 9_900_000 },
        { principal: 5_000_000, purchase_price: null },
      ],
      bondPayments: [{ amount: 30_000 }, { amount: 30_000 }],
    })
    expect(agg.bondValue).toBe(15_000_000)
    expect(agg.bondCost).toBe(14_900_000)
    expect(agg.bondPnl).toBe(100_000)
    expect(agg.bondCoupons).toBe(60_000)
  })

  it('converts non-IDR funds via fx and skips codes without a rate', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      fundPurchases: [
        { id: 1, fund_code: 'USDF', units: 100, buy_nav_per_unit: 1, currency: 'USD', purchased_at: '2026-01-01' },
        { id: 2, fund_code: 'EURF', units: 100, buy_nav_per_unit: 1, currency: 'EUR', purchased_at: '2026-01-01' },
      ],
      fundNavs: [
        { fund_code: 'USDF', nav: 1.1 },
        { fund_code: 'EURF', nav: 1.2 },
      ],
      fxToIdr: new Map([['USD', 16_000]]),
    })
    // EUR has no rate → excluded entirely
    expect(agg.fundCost).toBe(100 * 1 * 16_000)
    expect(agg.fundValue).toBe(100 * 1.1 * 16_000)
    expect(agg.fundPnl).toBeCloseTo(160_000)
  })

  it('combines income, realized, charges into total return', () => {
    const agg = aggregatePortfolio({
      ...emptyInput(),
      positions: [{ ticker: 'BBCA', avg_price: 9000, lots: 1, realized_pnl: 100_000 }],
      snapshots: [{ ticker: 'BBCA', current_price: 9100 }],
      stockDividends: [{ amount: 25_000 }],
      fundDistributions: [{ amount: 10_000 }],
      bondPayments: [{ amount: 15_000 }],
      accountCharges: [{ amount: 5_000 }],
    })
    expect(agg.totalIncome).toBe(50_000)
    expect(agg.combinedPnl).toBe(100 * 100)
    expect(agg.totalRealized).toBe(100_000)
    expect(agg.totalCapital).toBe(110_000)
    expect(agg.totalReturn).toBe(110_000 + 50_000 - 5_000)
  })
})
