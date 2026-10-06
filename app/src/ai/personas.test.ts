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

  it('defaults to a balanced six when PERSONAS unset; "all" enables 12', () => {
    delete process.env.PERSONAS
    expect(enabledPersonas().map(p => p.key)).toEqual(['buffett', 'burry', 'lynch', 'druckenmiller', 'graham', 'wood'])
    process.env.PERSONAS = 'all'
    expect(enabledPersonas()).toHaveLength(12)
  })

  it('filters to the configured subset, case-insensitive', () => {
    process.env.PERSONAS = 'Buffett, burry ,LYNCH'
    const picked = enabledPersonas()
    expect(picked.map(p => p.key)).toEqual(['buffett', 'burry', 'lynch'])
  })

  it('skips unknown names and falls back to the default set when none valid', () => {
    process.env.PERSONAS = 'nobody,unknown'
    expect(enabledPersonas()).toHaveLength(6)
  })

  it('numeric value takes the first N of a style-balanced order', () => {
    process.env.PERSONAS = '3'
    expect(enabledPersonas().map(p => p.key)).toEqual(['buffett', 'burry', 'lynch'])
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
    expect(user).not.toContain('Composite')        // no anchoring on the composite
    expect(user).toContain('KEY STATS: n/a')       // absent key stats are explicit
    expect(system).toMatch(/Use ONLY the data provided/)
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

describe('buildPersonaPrompt key stats', () => {
  it('renders stored fractions as percents', () => {
    const { user } = buildPersonaPrompt(PERSONAS.fisher, {
      ...payload,
      key_stats: { forward_pe: 12, peg_ratio: 1.1, return_on_equity: 0.185, profit_margins: 0.3,
        revenue_growth: 0.07, earnings_growth: -0.02, current_ratio: null, free_cashflow: 5e12 },
    })
    expect(user).toContain('ROE 18.5%')
    expect(user).toContain('earnings growth -2.0%')
    expect(user).toContain('current ratio n/a')
  })
})
