import { describe, it, expect } from 'vitest'
import { buildNumbersSection, buildLedgerSection, buildNewsSection, buildHandoverDoc, priceAt } from './weekReview'
import { aggregatePortfolio, type AggregateInput } from '../../../lib/aggregate'
import type { NewsSentimentRow, RecommendationAccuracyRow } from '../../../lib/types'

const emptyInput = (): AggregateInput => ({
  positions: [], snapshots: [], goldPurchases: [], goldPrices: [],
  bonds: [], bondPayments: [], fundPurchases: [], fundNavs: [],
  fxToIdr: new Map(), stockDividends: [], fundDistributions: [], accountCharges: [],
})

const agg = (positions: AggregateInput['positions'], snapshots: AggregateInput['snapshots']) =>
  aggregatePortfolio({ ...emptyInput(), positions, snapshots })

const accuracyRow = (over: Partial<RecommendationAccuracyRow> = {}): RecommendationAccuracyRow => ({
  ticker: 'BBCA', recommendation: 'BUY', analysed_at: '2026-07-10T02:00:00Z',
  price_at_rec: 9000, price_after: 9200, days_after: 3,
  actual_change_pct: 2.22, correct: true, ...over,
})

describe('buildNumbersSection', () => {
  it('renders WoW deltas and per-stock changes', () => {
    const current = agg([{ ticker: 'BBCA', avg_price: 9000, lots: 1 }], [{ ticker: 'BBCA', current_price: 9500 }])
    const weekAgo = agg([{ ticker: 'BBCA', avg_price: 9000, lots: 1 }], [{ ticker: 'BBCA', current_price: 9000 }])
    const md = buildNumbersSection(current, weekAgo, [
      { ticker: 'BBCA', priceNow: 9500, priceWeekAgo: 9000, changePct: 5.56 },
    ])
    expect(md).toContain('| Net Worth |')
    expect(md).toContain('+5.56%')
    expect(md).toContain('| Stocks |')
  })

  it('handles missing week-ago aggregate', () => {
    const current = agg([], [])
    const md = buildNumbersSection(current, null, [])
    expect(md).toContain('N/A')
    expect(md).not.toContain('### Stocks')
  })
})

describe('buildLedgerSection', () => {
  it('renders ledger rows and accuracy summary', () => {
    const md = buildLedgerSection(
      [{
        ticker: 'TLKM', recommendation: 'BUY', analysedAt: '2026-07-09T03:00:00Z',
        model: 'qwen', priceAtRec: 3000, priceNow: 3100, changeSincePct: 3.33,
      }],
      [accuracyRow(), accuracyRow({ correct: false })],
    )
    expect(md).toContain('| TLKM | BUY |')
    expect(md).toContain('1/2 correct (50%)')
  })

  it('notes when no recommendations were issued', () => {
    const md = buildLedgerSection([], [])
    expect(md).toContain('No new recommendations')
  })

  it('flags a failed ledger fetch instead of claiming an idle week', () => {
    const md = buildLedgerSection([], [], { ledger: true })
    expect(md).not.toContain('No new recommendations')
    expect(md).toContain('Recommendation ledger unavailable')
  })

  it('flags a failed accuracy query instead of staying silent', () => {
    const md = buildLedgerSection([], [], { accuracy: true })
    expect(md).toContain('Recommendation accuracy unavailable')
  })
})

describe('priceAt', () => {
  const series = [
    { current_price: 3000, fetched_at: '2026-07-09T01:00:00Z' },
    { current_price: 3100, fetched_at: '2026-07-09T05:00:00Z' },
    { current_price: 3200, fetched_at: '2026-07-10T01:00:00Z' },
  ]

  it('picks the last price at or before the cutoff', () => {
    expect(priceAt(series, new Date('2026-07-09T06:00:00Z'))).toBe(3100)
    expect(priceAt(series, new Date('2026-07-09T05:00:00Z'))).toBe(3100)
    expect(priceAt(series, new Date('2026-07-11T00:00:00Z'))).toBe(3200)
  })

  it('returns null when no point precedes the cutoff', () => {
    expect(priceAt(series, new Date('2026-07-08T00:00:00Z'))).toBeNull()
    expect(priceAt(undefined, new Date('2026-07-09T06:00:00Z'))).toBeNull()
  })

  it('skips null prices', () => {
    expect(priceAt([
      { current_price: 3000, fetched_at: '2026-07-09T01:00:00Z' },
      { current_price: null, fetched_at: '2026-07-09T02:00:00Z' },
    ], new Date('2026-07-09T03:00:00Z'))).toBe(3000)
  })
})

describe('buildNewsSection', () => {
  const sentimentRow = (over: Partial<NewsSentimentRow> = {}): NewsSentimentRow => ({
    ticker: 'BBCA.JK', summarized_at: '2026-07-14T02:00:00Z', depth: 'FULL',
    score: 3, themes: 'loan growth', catalyst: 'H1 earnings beat', risk: 'NIM compression', ...over,
  })

  it('renders per-ticker row with signed score, trend and fields', () => {
    const md = buildNewsSection([
      sentimentRow(),
      sentimentRow({ summarized_at: '2026-07-10T02:00:00Z', score: 1 }),
      sentimentRow({ ticker: 'TLKM.JK', score: -2, themes: 'data price war', catalyst: null, risk: null }),
    ])
    expect(md).toContain('## News Sentiment This Week')
    expect(md).toContain('| BBCA | +3 | avg +2.0 over 2 reads | loan growth | H1 earnings beat | NIM compression |')
    expect(md).toContain('| TLKM | -2 | single read | data price war | — | — |')
    expect(md).toContain('Score scale')
  })

  it('notes when no sentiment was recorded', () => {
    const md = buildNewsSection([])
    expect(md).toContain('No news sentiment recorded this week')
  })

  it('shows latest score when multiple reads exist (input newest-first)', () => {
    const md = buildNewsSection([
      sentimentRow({ score: -1 }),
      sentimentRow({ summarized_at: '2026-07-09T02:00:00Z', score: 4 }),
    ])
    expect(md).toContain('| BBCA | -1 |')
    expect(md).toContain('avg +1.5 over 2 reads')
  })

  it('truncates long text fields', () => {
    const md = buildNewsSection([sentimentRow({ themes: 'y'.repeat(200) })])
    expect(md).toContain(`${'y'.repeat(117)}…`)
    expect(md).not.toContain('y'.repeat(118))
  })
})

describe('buildHandoverDoc', () => {
  it('includes instructions, system description, accuracy table and sample output', () => {
    const md = buildHandoverDoc({
      weekStart: '2026-07-07', weekEnd: '2026-07-14', model: 'qwen2.5:7b',
      numbersSection: 'NUMBERS', ledgerSection: 'LEDGER', newsSection: 'NEWS-SENTIMENT',
      accuracy: [accuracyRow()],
      sampleRawOutput: 'RAW MODEL TEXT',
    })
    expect(md).toContain('Instructions for the reviewing LLM')
    expect(md).toContain('qwen2.5:7b')
    expect(md).toContain('NUMBERS')
    expect(md).toContain('NEWS-SENTIMENT')
    expect(md).toContain('| BBCA | BUY |')
    expect(md).toContain('RAW MODEL TEXT')
    expect(md).toContain('revised prompt template')
  })

  it('truncates very long sample output to 2000 chars', () => {
    const md = buildHandoverDoc({
      weekStart: '2026-07-07', weekEnd: '2026-07-14', model: 'm',
      numbersSection: '', ledgerSection: '', newsSection: '', accuracy: [],
      sampleRawOutput: 'x'.repeat(5000),
    })
    expect(md).toContain('x'.repeat(2000))
    expect(md).not.toContain('x'.repeat(2001))
  })
})
