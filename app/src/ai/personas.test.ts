import { describe, it, expect, afterEach } from 'vitest'
import {
  PERSONAS, enabledPersonas, buildPersonaPrompt, parsePersonaResult,
  type DeepRunPayload,
} from './personas'

const payload: DeepRunPayload = {
  snapshot_id: 1,
  ticker: 'BBCA.JK',
  held: true,
  lots: 10,
  avg_price: 6000,
  pnl_pct: 8.3,
  price: 6500,
  day_change_pct: 0.8,
  pe: 18,
  pb: 3,
  div_yield_pct: 2.5,
  dist_from_high: -18.8,
  dist_from_low: 30,
  scores: {
    technical: { score: 25, rationale: 'price above SMA20 by 3.2%' },
    valuation: { score: 10, rationale: 'P/E 18.0' },
    sentiment: { score: 80, rationale: 'news sentiment +4 of ±5' },
    momentum: { score: 30, rationale: '1W momentum +3.0%' },
    composite: 36,
  },
  news: { score: 4, themes: 'Banking Strength', catalyst: 'Foreign inflow', risk: 'Volatility' },
}

describe('PERSONAS', () => {
  it('defines all 12 investor personas', () => {
    expect(Object.keys(PERSONAS)).toHaveLength(12)
    for (const [key, def] of Object.entries(PERSONAS)) {
      expect(def.key).toBe(key)
      expect(def.name.length).toBeGreaterThan(0)
      expect(def.style.length).toBeGreaterThan(50)
    }
  })
})

describe('enabledPersonas', () => {
  afterEach(() => { delete process.env.PERSONAS })

  it('defaults to all 12 when PERSONAS unset', () => {
    delete process.env.PERSONAS
    expect(enabledPersonas()).toHaveLength(12)
  })

  it('filters to the configured subset, case-insensitive', () => {
    process.env.PERSONAS = 'Buffett, burry ,LYNCH'
    const picked = enabledPersonas()
    expect(picked.map(p => p.key)).toEqual(['buffett', 'burry', 'lynch'])
  })

  it('skips unknown names and falls back to all when none valid', () => {
    process.env.PERSONAS = 'nobody,unknown'
    expect(enabledPersonas()).toHaveLength(12)
  })

  it('numeric value takes the first N personas in definition order', () => {
    process.env.PERSONAS = '3'
    expect(enabledPersonas().map(p => p.key)).toEqual(['buffett', 'munger', 'graham'])
    process.env.PERSONAS = '99'
    expect(enabledPersonas()).toHaveLength(12)
  })
})

describe('buildPersonaPrompt', () => {
  it('embeds philosophy in system and scores in user, JSON-only instruction', () => {
    const { system, user } = buildPersonaPrompt(PERSONAS.buffett, payload)
    expect(system).toContain('Warren Buffett')
    expect(system).toContain('moats')
    expect(system).toContain('"signal"')
    expect(user).toContain('BBCA')
    expect(user).toContain('Technical 25')
    expect(user).toContain('Composite: 36')
    expect(user).toContain('held — 10 lots')
    expect(user).toContain('Foreign inflow')
    // The final verdict template must not leak into persona prompts
    expect(user).not.toContain('REKOMENDASI')
  })

  it('marks watchlist candidates as not held', () => {
    const { user } = buildPersonaPrompt(PERSONAS.graham, { ...payload, held: false })
    expect(user).toContain('not held')
  })
})

describe('parsePersonaResult', () => {
  it('parses clean JSON', () => {
    const r = parsePersonaResult('{"signal": "bullish", "confidence": 72, "reasoning": "Strong moat."}')
    expect(r).toEqual({ signal: 'bullish', confidence: 72, reasoning: 'Strong moat.' })
  })

  it('parses fenced/dirty output around the JSON', () => {
    const r = parsePersonaResult('Here is my view:\n```json\n{"signal": "BEARISH", "confidence": "55", "reasoning": "Overvalued."}\n```')
    expect(r?.signal).toBe('bearish')
    expect(r?.confidence).toBe(55)
  })

  it('clamps confidence to 0-100', () => {
    expect(parsePersonaResult('{"signal":"neutral","confidence":140,"reasoning":""}')?.confidence).toBe(100)
    expect(parsePersonaResult('{"signal":"neutral","confidence":-5,"reasoning":""}')?.confidence).toBe(0)
  })

  it('rejects invalid signal or missing confidence', () => {
    expect(parsePersonaResult('{"signal":"moon","confidence":50,"reasoning":""}')).toBeNull()
    expect(parsePersonaResult('{"signal":"bullish","reasoning":""}')).toBeNull()
    expect(parsePersonaResult('no json here at all')).toBeNull()
  })
})
