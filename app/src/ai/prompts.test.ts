import { describe, it, expect } from 'vitest'
import type { StockSnapshotRow } from '../../../lib/types'

const mockSnap: StockSnapshotRow = {
  ticker: 'BBCA.JK', current_price: 9600, day_change: 100, day_change_pct: 1.05,
  high_52w: 10200, low_52w: 8400,
  market_cap_raw: 1.15e14, pe: 15.3, pb: 2.2, div_yield_pct: 0.031,
  volume: 12_000_000,
  lots: 10, avg_price: 9000, unrealized_pnl: 600, unrealized_pnl_pct: 6.67, total_pnl: 600_000,
}

describe('buildPrompt', () => {
  it('includes ticker and price', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'LIGHT')
    expect(prompt).toContain('BBCA')
    expect(prompt).toContain('9.600')  // IDR formatted
  })

  it('includes depth instruction for DEEP', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'DEEP')
    expect(prompt.length).toBeGreaterThan(500)
  })

  it('includes news sentiment when provided', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL', 'Positive: bank sector growing')
    expect(prompt).toContain('Positive: bank sector growing')
  })

  it('adds a decisive-action guardrail for a held position when sentiment present', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL', 'Sentiment score: -4/5 (strongly bearish).\nBad news')
    expect(prompt).toContain('strongly bearish (-3 or lower)')
    expect(prompt).toContain('CUT LOSS or TRIM')
  })

  it('bars BUY on strongly bearish sentiment for a watchlist ticker', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const watch: StockSnapshotRow = { ...mockSnap, avg_price: 0, lots: 0 }
    const prompt = buildPrompt(watch, null, 'FULL', 'Sentiment score: -4/5 (strongly bearish).\nBad news')
    expect(prompt).toContain('do NOT issue BUY')
  })

  it('strips .JK suffix from ticker', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).not.toContain('BBCA.JK')
    expect(prompt).toContain('BBCA')
  })

  it('omits fundamentals block for LIGHT depth', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'LIGHT')
    expect(prompt).not.toContain('FUNDAMENTALS')
  })

  it('includes fundamentals block for FULL depth', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).toContain('FUNDAMENTALS')
    expect(prompt).toContain('P/E')
    expect(prompt).toContain('P/B')
  })

  it('includes sector comparison instruction for DEEP depth', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'DEEP')
    expect(prompt).toContain('Sector Comparison')
  })

  it('includes investor position block when avg_price is set', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).toContain('INVESTOR POSITION')
    expect(prompt).toContain('Lots Held')
  })

  it('includes company name and sector when metadata is provided', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL', undefined, {
      name: 'Bank Central Asia',
      sector: 'Financial Services',
      industry: 'Banks - Diversified',
    })
    expect(prompt).toContain('BBCA — Bank Central Asia')
    expect(prompt).toContain('Sector: Financial Services | Banks - Diversified')
  })

  it('omits name/sector line when metadata is not provided', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).not.toContain('Sector:')
    expect(prompt).toContain('=== BBCA ===')
  })

  it('includes a WIB session label in the prompt', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).toContain('=== MARKET SESSION:')
    // Session label matches one of the known patterns
    const sessionPatterns = [
      'SESSION 1 OPEN',
      'SESSION 1 —',
      'SESSION 1 CLOSE',
      'SESSION 2 OPEN',
      'SESSION 2 —',
      'MARKET CLOSE',
      'PORTFOLIO UPDATE',
    ]
    const hasSession = sessionPatterns.some((p) => prompt.includes(p))
    expect(hasSession).toBe(true)
  })

  it('requires a REKOMENDASI line with the position vocabulary when held', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).toContain('REKOMENDASI:')
    expect(prompt).toContain('independent of position size')
    expect(prompt).toContain('Recommended Action')
  })

  it('asks for a pure entry signal without the P&L threshold for watchlist tickers', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt({ ...mockSnap, avg_price: 0, lots: 0 }, null, 'LIGHT')
    expect(prompt).toContain('Entry Signal')
    expect(prompt).toContain('REKOMENDASI:')
    expect(prompt).not.toContain('Rp 1.000.000')
  })

  it('renders a TECHNICALS block when indicators are provided', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL', undefined, undefined, {
      sma20: 9400, sma50: 9200, rsi14: 62, mom1wPct: 3.2, volRatio20: 1.4, relStrength1wPct: 2.1,
    })
    expect(prompt).toContain('TECHNICALS (daily):')
    expect(prompt).toContain('SMA20')
    expect(prompt).toContain('RSI(14): 62 (bullish)')
    expect(prompt).toContain('vs IHSG 1W: +2.1pp')
    expect(prompt).toContain('Volume vs 20d avg: 1.4x')
  })

  it('omits the TECHNICALS block without indicators', async () => {
    const { buildPrompt } = await import('./prompts.js')
    const prompt = buildPrompt(mockSnap, null, 'FULL')
    expect(prompt).not.toContain('TECHNICALS')
  })

  it('has TODO comments for missing fundamentals fields', async () => {
    // Import the raw source text to verify TODO comments are present in code
    const fs = await import('fs')
    const src = fs.readFileSync(new URL('./prompts.ts', import.meta.url).pathname, 'utf-8')
    expect(src).toContain('TODO: beta')
    expect(src).toContain('TODO: roe_pct')
    expect(src).toContain('TODO: eps')
    expect(src).toContain('TODO: debt_to_equity')
  })
})
