import { describe, it, expect } from 'vitest'
import { computeAnalystScores } from './scores'
import type { StockSnapshotRow } from '../../../lib/types'
import type { Indicators } from './indicators'

const snap = (over: Partial<StockSnapshotRow> = {}): StockSnapshotRow => ({
  ticker: 'BBCA.JK',
  current_price: 6500,
  day_change: 50,
  day_change_pct: 0.8,
  high_52w: 8000,
  low_52w: 5000,
  volume: 1_000_000,
  avg_price: 6000,
  lots: 10,
  unrealized_pnl: 500,
  unrealized_pnl_pct: 8.3,
  total_pnl: 500_000,
  pe: 18,
  pb: 3,
  div_yield_pct: 2.5,
  market_cap_raw: null,
  ...over,
})

const ind = (over: Partial<Indicators> = {}): Indicators => ({
  sma20: 6300,
  sma50: 6100,
  rsi14: 60,
  mom1wPct: 3,
  volRatio20: 1.0,
  relStrength1wPct: 1.5,
  ...over,
})

describe('computeAnalystScores', () => {
  it('is null-safe: all-null inputs give zero scores with rationale', () => {
    const s = computeAnalystScores(
      snap({ current_price: null, pe: null, pb: null, div_yield_pct: null, dist_from_high: null }),
      null,
      null,
    )
    expect(s.technical.score).toBe(0)
    expect(s.technical.rationale).toBe('insufficient data')
    expect(s.valuation.score).toBe(0)
    expect(s.momentum.score).toBe(0)
    expect(s.sentiment.score).toBe(0)
    expect(s.composite).toBe(0)
  })

  it('bullish setup scores positive across the board', () => {
    const s = computeAnalystScores(snap({ pe: 8, pb: 0.9, div_yield_pct: 6 }), ind(), 4)
    expect(s.technical.score).toBeGreaterThan(0)
    expect(s.valuation.score).toBeGreaterThan(0)
    expect(s.sentiment.score).toBe(80)   // 4 * 20
    expect(s.momentum.score).toBeGreaterThan(0)
    expect(s.composite).toBeGreaterThan(0)
    expect(s.valuation.rationale).toContain('dividend yield 6.0%')
  })

  it('bearish setup scores negative', () => {
    const s = computeAnalystScores(
      snap({ current_price: 5000, pe: 40, pb: 6, div_yield_pct: null }),
      ind({ sma20: 5600, sma50: 5900, rsi14: 75, mom1wPct: -8, relStrength1wPct: -4 }),
      -3,
    )
    expect(s.technical.score).toBeLessThan(0)
    expect(s.valuation.score).toBeLessThan(0)
    expect(s.sentiment.score).toBe(-60)
    expect(s.momentum.score).toBeLessThan(0)
    expect(s.composite).toBeLessThan(0)
  })

  it('overbought RSI penalizes technicals', () => {
    const hot = computeAnalystScores(snap(), ind({ rsi14: 75 }), null)
    const calm = computeAnalystScores(snap(), ind({ rsi14: 60 }), null)
    expect(hot.technical.score).toBeLessThan(calm.technical.score)
  })

  it('high volume amplifies momentum in its direction', () => {
    const loud = computeAnalystScores(snap(), ind({ mom1wPct: 5, volRatio20: 3 }), null)
    const quiet = computeAnalystScores(snap(), ind({ mom1wPct: 5, volRatio20: 1 }), null)
    expect(loud.momentum.score).toBeGreaterThan(quiet.momentum.score)
  })

  it('clamps all scores to [-100, 100]', () => {
    const s = computeAnalystScores(
      snap({ pe: 3, pb: 0.3, div_yield_pct: 15 }),
      ind({ mom1wPct: 30, relStrength1wPct: 25, volRatio20: 10, rsi14: 20 }),
      5,
    )
    for (const sub of [s.technical, s.valuation, s.sentiment, s.momentum]) {
      expect(sub.score).toBeGreaterThanOrEqual(-100)
      expect(sub.score).toBeLessThanOrEqual(100)
    }
    expect(Math.abs(s.composite)).toBeLessThanOrEqual(100)
  })

  it('composite averages only sub-scores that had data', () => {
    // Only sentiment has data → composite equals sentiment score
    const s = computeAnalystScores(
      snap({ current_price: null, pe: null, pb: null, div_yield_pct: null, dist_from_high: null }),
      null,
      2,
    )
    expect(s.sentiment.score).toBe(40)
    expect(s.composite).toBe(40)
  })

  it('missing news does not dilute the composite', () => {
    const withoutNews = computeAnalystScores(snap({ pe: 8, pb: 0.9, div_yield_pct: 6 }), ind(), null)
    expect(withoutNews.sentiment.rationale).toBe('insufficient data')
    const parts = [withoutNews.technical, withoutNews.valuation, withoutNews.momentum]
    expect(withoutNews.composite).toBe(Math.round(parts.reduce((a, p) => a + p.score, 0) / 3))
  })
})

describe('relativeValuationScore', () => {
  const v = (peerDiff: number | null, peerVerdict: string, quality: string, ownDiff: number | null) => ({
    ticker: 'X', lens: 'PB_ROE', multiple_name: 'P/B', value: 2,
    peers: { count: 8, median: 1, diff: peerDiff, verdict: peerVerdict, tickers: [] },
    quality: { name: 'ROE', value: 0.2, peer_median: 0.1, verdict: quality },
    own: { avg: 2, years: 4, diff: ownDiff, verdict: 'in line' },
    read: '', summary: '',
  }) as never

  it('rewards a discount and penalises a premium', async () => {
    const { relativeValuationScore } = await import('./scores.js')
    expect(relativeValuationScore(v(-0.4, 'discount', 'similar', null)).score).toBe(40)
    expect(relativeValuationScore(v(0.4, 'premium', 'similar', null)).score).toBe(-40)
  })
  it('halves a gap that quality explains', async () => {
    const { relativeValuationScore } = await import('./scores.js')
    expect(relativeValuationScore(v(1.0, 'premium', 'stronger', null)).score).toBe(-25)
  })
  it('adds the pull from its own history', async () => {
    const { relativeValuationScore } = await import('./scores.js')
    expect(relativeValuationScore(v(0, 'on par', 'similar', -0.5)).score).toBe(20)
  })
  it('computeAnalystScores prefers the peer valuation over absolute bands', async () => {
    const { computeAnalystScores } = await import('./scores.js')
    const s = computeAnalystScores(snap({ pe: 8, pb: 0.9 }), ind(), null, v(0.4, 'premium', 'similar', null))
    expect(s.valuation.score).toBe(-40)
    expect(s.valuation.rationale).toContain('premium vs 8 peers')
  })
})
