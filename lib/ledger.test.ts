import { describe, it, expect } from 'vitest'
import { foldWeightedAvg } from './ledger'

describe('foldWeightedAvg', () => {
  it('single buy', () => {
    const r = foldWeightedAvg([{ side: 'BUY', qty: 10, price: 1000 }])
    expect(r).toEqual({ netQty: 10, avgBuy: 1000, totalBuyCost: 10000, realizedPnl: 0 })
  })

  it('two buys average by weight', () => {
    const r = foldWeightedAvg([
      { side: 'BUY', qty: 10, price: 1000 },
      { side: 'BUY', qty: 30, price: 1200 },
    ])
    expect(r.netQty).toBe(40)
    expect(r.avgBuy).toBe(1150) // (10*1000 + 30*1200)/40
    expect(r.realizedPnl).toBe(0)
  })

  it('sell realizes gain, avg unchanged, cost basis reduced', () => {
    const r = foldWeightedAvg([
      { side: 'BUY', qty: 10, price: 1000 },
      { side: 'SELL', qty: 4, price: 1200 },
    ])
    expect(r.netQty).toBe(6)
    expect(r.avgBuy).toBe(1000)
    expect(r.realizedPnl).toBe(800) // (1200-1000)*4
    expect(r.totalBuyCost).toBe(6000) // 6 remaining * 1000
  })

  it('sell then buy: realized locked at pre-buy avg', () => {
    const r = foldWeightedAvg([
      { side: 'BUY', qty: 10, price: 1000 },
      { side: 'SELL', qty: 5, price: 1500 },
      { side: 'BUY', qty: 5, price: 2000 },
    ])
    expect(r.realizedPnl).toBe(2500) // (1500-1000)*5, sold at avg 1000
    expect(r.netQty).toBe(10)
    expect(r.avgBuy).toBe(1500) // remaining 5@1000 + new 5@2000 -> 1500
  })

  it('fully closed position: netQty 0, avg 0', () => {
    const r = foldWeightedAvg([
      { side: 'BUY', qty: 10, price: 1000 },
      { side: 'SELL', qty: 10, price: 900 },
    ])
    expect(r.netQty).toBe(0)
    expect(r.avgBuy).toBe(0)
    expect(r.realizedPnl).toBe(-1000)
  })
})
