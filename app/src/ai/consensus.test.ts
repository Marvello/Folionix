import { describe, it, expect } from 'vitest'
import {
  aggregateSignals, mapToRecommendation, buildConsensusPrompt,
  enforceRecommendation, type PersonaVote,
} from './consensus'
import type { AnalystScores } from './scores'
import type { DeepRunPayload } from './personas'

const scores = (composite = 0): AnalystScores => ({
  technical: { score: 0, rationale: 'x' },
  valuation: { score: 0, rationale: 'x' },
  sentiment: { score: 0, rationale: 'x' },
  momentum: { score: 0, rationale: 'x' },
  composite,
})

const vote = (signal: PersonaVote['signal'], confidence: number, persona = 'buffett'): PersonaVote =>
  ({ persona, signal, confidence, reasoning: 'r' })

describe('aggregateSignals', () => {
  it('returns composite when no votes', () => {
    expect(aggregateSignals([], scores(42))).toBe(42)
  })

  it('weights persona net 70/30 against composite', () => {
    // Two bullish @ 80 → personaNet 80; composite 0 → 0.7*80 = 56
    expect(aggregateSignals([vote('bullish', 80), vote('bullish', 80, 'burry')], scores(0))).toBe(56)
  })

  it('bearish votes drive the net negative', () => {
    const net = aggregateSignals([vote('bearish', 90), vote('bearish', 70, 'burry'), vote('neutral', 50, 'lynch')], scores(-30))
    expect(net).toBeLessThan(-40)
  })

  it('neutral votes dilute conviction', () => {
    const strong = aggregateSignals([vote('bullish', 90)], scores(0))
    const diluted = aggregateSignals([vote('bullish', 90), vote('neutral', 90, 'burry')], scores(0))
    expect(diluted).toBeLessThan(strong)
  })
})

describe('mapToRecommendation', () => {
  it('watchlist: BUY / MONITOR / HOLD only', () => {
    expect(mapToRecommendation(60, false, null)).toBe('BUY')
    expect(mapToRecommendation(25, false, null)).toBe('MONITOR')
    expect(mapToRecommendation(0, false, null)).toBe('HOLD')
    expect(mapToRecommendation(-80, false, null)).toBe('HOLD')
  })

  it('held: every keyword reachable', () => {
    expect(mapToRecommendation(60, true, 5)).toBe('BUY')
    expect(mapToRecommendation(60, true, -8)).toBe('AVERAGE DOWN')
    expect(mapToRecommendation(0, true, 0)).toBe('HOLD')
    expect(mapToRecommendation(-25, true, 10)).toBe('TRIM')
    expect(mapToRecommendation(-25, true, -10)).toBe('MONITOR')
    expect(mapToRecommendation(-60, true, 10)).toBe('TAKE PROFIT')
    expect(mapToRecommendation(-60, true, -10)).toBe('CUT LOSS')
  })
})

describe('buildConsensusPrompt', () => {
  const payload: DeepRunPayload = {
    snapshot_id: 1, ticker: 'TLKM.JK', held: false, lots: 0, avg_price: 0,
    pnl_pct: null, price: 2660, day_change_pct: 5.1, pe: 15, pb: 2,
    div_yield_pct: 4, dist_from_high: -10, dist_from_low: 20,
    scores: scores(30), news: null,
  }

  it('includes votes, decided verdict, and REKOMENDASI template line', () => {
    const { system, user } = buildConsensusPrompt(payload, [vote('bullish', 75)], 'MONITOR')
    expect(system).toContain('MONITOR')
    expect(user).toContain('Warren Buffett: BULLISH (75%)')
    expect(user).toContain('REKOMENDASI: MONITOR')
    expect(user).toContain('TLKM')
  })
})

describe('enforceRecommendation', () => {
  it('appends the decided keyword when missing', () => {
    const out = enforceRecommendation('<b>Report</b>\nSome prose.', 'BUY')
    expect(out.endsWith('REKOMENDASI: BUY')).toBe(true)
  })

  it('replaces a wrong REKOMENDASI line the model wrote', () => {
    const out = enforceRecommendation('<b>Report</b>\nREKOMENDASI: HOLD\nmore', 'CUT LOSS')
    expect(out).not.toContain('REKOMENDASI: HOLD')
    expect(out.endsWith('REKOMENDASI: CUT LOSS')).toBe(true)
  })
})
