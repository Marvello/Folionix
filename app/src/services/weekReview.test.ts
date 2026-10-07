import { describe, it, expect } from 'vitest'
import {
  buildNumbersSection, buildLedgerSection, buildNewsSection, buildHandoverDoc, priceAt,
  holdingValues, allocationPct, buildAllocationSection, collectWeekActivity, activityTotals,
  buildActivitySection, collectUpcoming, buildUpcomingSection, wibDay,
} from './weekReview'
import { aggregatePortfolio, type AggregateInput } from '../../../lib/aggregate'
import type { BondHoldingRow, DividendScheduleRow, NewsSentimentRow, RecommendationAccuracyRow } from '../../../lib/types'

const emptyInput = (): AggregateInput => ({
  positions: [], snapshots: [], goldPurchases: [], goldPrices: [],
  bonds: [], bondPayments: [], fundPurchases: [], fundNavs: [],
  fxToIdr: new Map(), stockDividends: [], fundDistributions: [], accountCharges: [],
})

const agg = (positions: AggregateInput['positions'], snapshots: AggregateInput['snapshots']) =>
  aggregatePortfolio({ ...emptyInput(), positions, snapshots })

const accuracyRow = (over: Partial<RecommendationAccuracyRow> = {}): RecommendationAccuracyRow => ({
  ticker: 'BBCA', recommendation: 'BUY', rec_class: 'BUY-ISH',
  analysed_at: '2026-07-10T02:00:00Z',
  price_at_rec: 9000, price_after: 9200, days_after: 3,
  actual_change_pct: 2.22, benchmark_change_pct: 0.5, correct: true, ...over,
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

  it('splits accuracy by class so a HOLD-heavy sample cannot hide bad calls', () => {
    // 4 HOLD-ish all right, 2 actionable both wrong: blended 67%, but the
    // classes are 100% and 0% — the split is the point.
    const md = buildLedgerSection([], [
      ...Array.from({ length: 4 }, () => accuracyRow({ recommendation: 'HOLD', rec_class: 'HOLD-ISH', correct: true })),
      accuracyRow({ recommendation: 'CUT LOSS', rec_class: 'SELL-ISH', correct: false }),
      accuracyRow({ recommendation: 'AVERAGE DOWN', rec_class: 'BUY-ISH', correct: false }),
    ])
    expect(md).toContain('| HOLD-ISH | 4 | 4 | 100% |')
    expect(md).toContain('| SELL-ISH | 1 | 0 | 0% |')
    expect(md).toContain('| BUY-ISH | 1 | 0 | 0% |')
    expect(md).toContain('4/6 correct (67%)')
  })

  it('shows a dash rather than NaN for a class with no scored recs', () => {
    const md = buildLedgerSection([], [accuracyRow({ rec_class: 'HOLD-ISH' })])
    expect(md).toContain('| SELL-ISH | 0 | 0 | — |')
    expect(md).not.toContain('NaN')
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

// ── whole-portfolio sections ──

const bond = (over: Partial<BondHoldingRow> = {}): BondHoldingRow => ({
  id: 1, series_code: 'SR018', series_type: 'SR', principal: 10_000_000, coupon_rate: 6.4,
  maturity_date: '2027-12-10', notes: null, active: true, ...over,
})

const mixedInput = (): AggregateInput => ({
  ...emptyInput(),
  positions: [{ ticker: 'BBCA.JK', avg_price: 9000, lots: 10 }, { ticker: 'TLKM.JK', avg_price: 3000, lots: 0 }],
  snapshots: [{ ticker: 'BBCA.JK', current_price: 10000 }],
  goldPurchases: [
    { venue: 'Pegadaian', grams: 10, buy_price_per_gram: 1_500_000, purchased_at: '2026-01-01T00:00:00Z' },
    { venue: 'Pegadaian', grams: 4, buy_price_per_gram: 1_600_000, purchased_at: '2026-02-01T00:00:00Z', side: 'SELL' },
  ],
  goldPrices: [{ venue: 'Pegadaian', sell_price: 2_000_000 }],
  fundPurchases: [{ fund_code: 'USDF', units: 100, buy_nav_per_unit: 1, currency: 'USD', purchased_at: '2026-01-01T00:00:00Z' }],
  fundNavs: [{ fund_code: 'USDF', nav: 1.5 }],
  fxToIdr: new Map([['USD', 16000]]),
  bonds: [{ principal: 10_000_000, purchase_price: null }],
})

describe('holdingValues', () => {
  it('values each holding with the shared aggregate (netted gold, fx funds) and sums to net worth', () => {
    const input = mixedInput()
    const hv = holdingValues(input, { fundNames: new Map([['USDF', 'USD Fund']]), bonds: [bond()] })
    expect(hv.map(h => [h.kind, h.name, h.value])).toEqual([
      ['Gold', 'Pegadaian', 12_000_000], // 6 g net × 2,000,000
      ['Stock', 'BBCA', 10_000_000],
      ['Bond', 'SR018', 10_000_000],
      ['Fund', 'USD Fund', 2_400_000], // 100 × 1.5 × 16,000
    ])
    const total = hv.reduce((a, h) => a + h.value, 0)
    expect(total).toBeCloseTo(aggregatePortfolio(input).netWorth)
  })
})

describe('buildAllocationSection', () => {
  it('shows class shares, top holdings and concentration warnings', () => {
    const input = mixedInput()
    const current = aggregatePortfolio(input)
    const md = buildAllocationSection(current, holdingValues(input, { bonds: [bond()] }))
    expect(md).toContain('## Allocation & Concentration')
    expect(md).toContain('| Gold | Rp 12.000.000 | 34.9% |')
    expect(md).toContain('| Pegadaian | Gold |')
    // every holding here is above 20% of a ~34.4m portfolio except the fund
    expect(md).toContain('⚠️ Pegadaian (Gold) is 34.9% of net worth')
    expect(md).not.toContain('USDF (Fund) is')
    expect(md).not.toContain('SR018 (Bond) is') // sovereign series: shown, never flagged
    expect(md).not.toContain('above 60%')
  })

  it('flags an asset class above 60% and survives an empty portfolio', () => {
    const one = aggregatePortfolio({ ...emptyInput(), positions: [{ ticker: 'BBCA.JK', avg_price: 9000, lots: 1 }], snapshots: [] })
    expect(buildAllocationSection(one, [])).toContain('Stocks is 100.0% of net worth (above 60%)')
    const empty = aggregatePortfolio(emptyInput())
    const md = buildAllocationSection(empty, [])
    expect(md).toContain('N/A')
    expect(md).not.toContain('NaN')
    expect(allocationPct(empty).stocks).toBeNull()
  })
})

describe('collectWeekActivity', () => {
  const src = () => ({
    transactions: [
      { ticker: 'BBCA.JK', side: 'BUY' as const, lots: 2, price: 9000, fee: 5000, txn_at: '2026-10-05T02:00:00Z' },
      { ticker: 'BBCA.JK', side: 'SELL' as const, lots: 1, price: 9500, txn_at: '2026-10-07T03:00:00Z' },
      // 2026-09-30 17:30Z is 2026-10-01 00:30 WIB → inside the week
      { ticker: 'TLKM.JK', side: 'BUY' as const, lots: 1, price: 3000, txn_at: '2026-09-30T17:30:00Z' },
      // 2026-09-30 10:00Z is still 2026-09-30 WIB → the start day itself is excluded
      { ticker: 'ASII.JK', side: 'BUY' as const, lots: 1, price: 5000, txn_at: '2026-09-30T10:00:00Z' },
    ],
    goldPurchases: [{ venue: 'Pegadaian', grams: 1, buy_price_per_gram: 2_000_000, purchased_at: '2026-10-02T00:00:00Z', notes: null, active: true }],
    fundPurchases: [
      { fund_code: 'USDF', fund_name: 'USD Fund', units: 10, buy_nav_per_unit: 1, currency: 'USD', purchased_at: '2026-10-03T00:00:00Z', notes: null, active: true },
      { fund_code: 'EURF', units: 10, buy_nav_per_unit: 1, currency: 'EUR', purchased_at: '2026-10-03T00:00:00Z', notes: null, active: true },
    ],
    fxToIdr: new Map([['USD', 16000]]),
    stockDividends: [{ ticker: 'BBCA.JK', amount: 270_000, paid_at: '2026-10-06' }, { ticker: 'BBCA.JK', amount: 1, paid_at: '2026-09-01' }],
    fundDistributions: [{ fund_code: 'USDF', amount: 50_000, paid_at: '2026-10-04' }],
    couponPayments: [{ bond_holding_id: 1, paid_at: '2026-10-07', amount: 48_000 }, { bond_holding_id: 99, paid_at: '2026-10-07', amount: 1000 }],
    bonds: [bond()],
    accountCharges: [{ type: 'DATA_FEE' as const, amount: 10_000, charged_at: '2026-10-01' }],
  })

  it('keeps only rows whose WIB day is in (weekStart, weekEnd] and converts fx', () => {
    const a = collectWeekActivity(src(), '2026-09-30', '2026-10-07')
    expect(a.trades.map(t => `${t.kind} ${t.name} ${t.side}`)).toEqual([
      'Stock TLKM BUY', 'Gold Pegadaian BUY', 'Fund USD Fund BUY', 'Fund EURF BUY', 'Stock BBCA BUY', 'Stock BBCA SELL',
    ])
    expect(a.trades.find(t => t.name === 'USD Fund')?.amount).toBe(160_000)
    expect(a.trades.find(t => t.name === 'EURF')?.amount).toBeNull() // no EUR rate → N/A, not a wrong number
    expect(a.income.map(i => `${i.kind} ${i.name}`)).toEqual(['Distribution USD Fund', 'Dividend BBCA', 'Coupon SR018', 'Coupon bond #99'])
    expect(activityTotals(a)).toEqual({
      bought: 300_000 + 2_000_000 + 160_000 + 1_800_000, sold: 950_000, income: 270_000 + 50_000 + 48_000 + 1000, fees: 10_000,
    })
  })

  it('renders tables and totals, and distinguishes failure from a quiet week', () => {
    const md = buildActivitySection(collectWeekActivity(src(), '2026-09-30', '2026-10-07'))
    expect(md).toContain('| 2026-10-05 | Stock | BBCA | BUY | 2 lots @ 9.000 + fee 5.000 | Rp 1.800.000 |')
    expect(md).toContain('Total income: Rp 369.000.')
    expect(md).toContain('Total fees: Rp 10.000.')
    expect(buildActivitySection({ trades: [], income: [], fees: [] })).toContain('No trades, income or fees')
    expect(buildActivitySection({ trades: [], income: [], fees: [] }, true)).toContain('Activity unavailable')
  })

  it('wibDay passes dates through and converts timestamps to Jakarta days', () => {
    expect(wibDay('2026-10-01')).toBe('2026-10-01')
    expect(wibDay('2026-09-30T17:30:00Z')).toBe('2026-10-01')
  })
})

describe('collectUpcoming', () => {
  const sched = (over: Partial<DividendScheduleRow> = {}): DividendScheduleRow => ({
    id: 1, ticker: 'BBCA.JK', cum_date: '2026-10-12', ex_date: '2026-10-13', recording_date: null, pay_date: '2026-11-01',
    amount_per_share: 135, amount_estimated: true, currency: 'IDR', source: 'idx', synced_at: '', ...over,
  })

  it('lists held-ticker dividend dates, coupons and maturities in their windows', () => {
    const ev = collectUpcoming({
      schedule: [sched(), sched({ ticker: 'UNVR.JK', ex_date: '2026-10-10' })],
      positions: [{ ticker: 'BBCA.JK', lots: 10 }],
      bonds: [bond(), bond({ id: 2, series_code: 'ORI025', maturity_date: '2026-12-15', coupon_rate: 6.2 })],
      couponDates: [
        { bond_holding_id: 1, distribution_date: '2026-10-10' }, { bond_holding_id: 1, distribution_date: '2026-11-10' },
        { bond_holding_id: 2, distribution_date: '2026-10-15' }, { bond_holding_id: 2, distribution_date: '2026-11-15' },
      ],
      couponPayments: [{ bond_holding_id: 1, paid_at: '2026-09-10', amount: 48_000 }],
    }, '2026-10-07', '2026-10-21', '2027-01-05')
    expect(ev.map(e => `${e.date} ${e.event} ${e.name}`)).toEqual([
      '2026-10-10 Coupon SR018', '2026-10-13 Ex-dividend BBCA', '2026-10-15 Coupon ORI025', '2026-12-15 Maturity ORI025',
    ])
    expect(ev[0].detail).toBe('≈ Rp 48.000 net') // last actual payment beats the estimate
    expect(ev[1].detail).toContain('≈ Rp 135.000 on 1.000 shares')
    expect(ev[1].detail).toContain('(est.)')
    expect(ev[2].detail).toBe('≈ Rp 46.500 net') // 10m × 6.2% / 12 × 0.9
    const md = buildUpcomingSection(ev)
    expect(md).toContain('| 2026-12-15 | Maturity | ORI025 |')
  })

  it('renders empty and failed states', () => {
    expect(buildUpcomingSection([])).toContain('No dividend dates or coupons')
    expect(buildUpcomingSection([], true)).toContain('Upcoming events unavailable')
  })
})

describe('buildNumbersSection gold/fund moves', () => {
  it('renders per-unit week change with units and N/A for missing history', () => {
    const md = buildNumbersSection(aggregatePortfolio(emptyInput()), null, [], [
      { kind: 'Gold', name: 'Pegadaian', unit: 'IDR/g', now: 2_100_000, weekAgo: 2_000_000 },
      { kind: 'Fund', name: 'USD Fund', unit: 'USD/unit', now: 1.2345, weekAgo: null },
    ])
    expect(md).toContain('| Pegadaian | Gold | IDR/g | 2.100.000 | 2.000.000 | +5.00% |')
    expect(md).toContain('| USD Fund | Fund | USD/unit | 1,2345 | N/A | N/A |')
  })
})

describe('buildHandoverDoc portfolio sections', () => {
  it('places portfolio sections between numbers and ledger', () => {
    const md = buildHandoverDoc({
      weekStart: 'a', weekEnd: 'b', model: 'm', numbersSection: 'NUMBERS', portfolioSections: ['ALLOC', 'ACTIVITY'],
      ledgerSection: 'LEDGER', newsSection: '', accuracy: [], sampleRawOutput: null,
    })
    expect(md.indexOf('NUMBERS')).toBeLessThan(md.indexOf('ALLOC'))
    expect(md.indexOf('ACTIVITY')).toBeLessThan(md.indexOf('LEDGER'))
    expect(md).toContain('Portfolio-level observations')
  })
})
