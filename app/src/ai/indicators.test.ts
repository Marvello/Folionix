import { describe, it, expect } from 'vitest'
import { toDailySeries, computeIndicators, momentumPct, rsiLabel, type DailyPoint } from './indicators'

const day = (i: number, close: number, volume: number | null = 1000): DailyPoint => ({
  date: `2026-06-${String(i + 1).padStart(2, '0')}`,
  close,
  volume,
})

describe('toDailySeries', () => {
  it('keeps the last snapshot per WIB day, sorted ascending', () => {
    const rows = [
      { current_price: 100, volume: 10, fetched_at: '2026-07-01T03:00:00Z' }, // 10:00 WIB
      { current_price: 105, volume: 20, fetched_at: '2026-07-01T08:00:00Z' }, // 15:00 WIB — wins
      { current_price: 110, volume: 30, fetched_at: '2026-07-02T03:00:00Z' },
      { current_price: null, volume: 5, fetched_at: '2026-07-03T03:00:00Z' }, // priceless — dropped
    ]
    const daily = toDailySeries(rows)
    expect(daily).toHaveLength(2)
    expect(daily[0]).toEqual({ date: '2026-07-01', close: 105, volume: 20 })
    expect(daily[1].close).toBe(110)
  })

  it('rolls a late-night UTC snapshot into the next WIB day', () => {
    // 20:00 UTC = 03:00 WIB next day
    const daily = toDailySeries([{ current_price: 100, volume: 1, fetched_at: '2026-07-01T20:00:00Z' }])
    expect(daily[0].date).toBe('2026-07-02')
  })
})

describe('computeIndicators', () => {
  it('returns null for too-short history', () => {
    expect(computeIndicators([day(0, 100)])).toBeNull()
  })

  it('computes SMA20 and leaves SMA50 null on 30 days of data', () => {
    const daily = Array.from({ length: 30 }, (_, i) => day(i, 100))
    const ind = computeIndicators(daily)!
    expect(ind.sma20).toBe(100)
    expect(ind.sma50).toBeNull()
  })

  it('computes RSI extremes', () => {
    const rising = Array.from({ length: 20 }, (_, i) => day(i, 100 + i))
    expect(computeIndicators(rising)!.rsi14).toBe(100)
    const falling = Array.from({ length: 20 }, (_, i) => day(i, 200 - i))
    expect(computeIndicators(falling)!.rsi14).toBe(0)
    const flat = Array.from({ length: 20 }, (_, i) => day(i, 100))
    expect(computeIndicators(flat)!.rsi14).toBe(50)
  })

  it('computes 1W momentum and relative strength vs index', () => {
    const stock = Array.from({ length: 10 }, (_, i) => day(i, 100 + i * 2)) // +2/day
    const index = Array.from({ length: 10 }, (_, i) => day(i, 100 + i))     // +1/day
    const ind = computeIndicators(stock, index)!
    // stock: 118 vs 108 five days earlier = +9.26%; index: 109 vs 104 = +4.81%
    expect(ind.mom1wPct).toBeCloseTo(9.26, 1)
    expect(ind.relStrength1wPct).toBeCloseTo(9.26 - 4.81, 1)
  })

  it('computes volume ratio vs 20-day average', () => {
    const daily = Array.from({ length: 25 }, (_, i) => day(i, 100, i === 24 ? 3000 : 1000))
    const ind = computeIndicators(daily)!
    // last 20 vols: 19×1000 + 3000 = 22000 → avg 1100; ratio 3000/1100
    expect(ind.volRatio20).toBeCloseTo(3000 / 1100, 2)
  })
})

describe('momentumPct', () => {
  it('is null without enough points', () => {
    expect(momentumPct([day(0, 100), day(1, 101)], 5)).toBeNull()
  })
})

describe('rsiLabel', () => {
  it('maps bands', () => {
    expect(rsiLabel(75)).toBe('overbought')
    expect(rsiLabel(60)).toBe('bullish')
    expect(rsiLabel(50)).toBe('neutral')
    expect(rsiLabel(35)).toBe('bearish')
    expect(rsiLabel(20)).toBe('oversold')
  })
})
