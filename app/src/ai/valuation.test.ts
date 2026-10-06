import { describe, it, expect } from 'vitest'
import { lensFor, multipleOf, median, valuate, type ValuationInput } from './valuation'

const base: ValuationInput = {
  ticker: 'X.JK', sector: 'Keuangan', market_cap: 1000, trailing_pe: 10, price_to_book: 2,
  total_revenue: 500, ebitda: 100, total_debt: 200, total_cash: 100,
  return_on_equity: 0.15, earnings_growth: 0.1, revenue_growth: 0.05, ebitda_margins: 0.2, div_yield_pct: 4,
}
const bank = (t: string, pb: number, roe: number): ValuationInput => ({ ...base, ticker: t, price_to_book: pb, return_on_equity: roe })

describe('lensFor', () => {
  it('maps IDX sectors to the multiple that fits them', () => {
    expect(lensFor('Keuangan', false)).toBe('PB_ROE')
    expect(lensFor('Barang Konsumen Primer', false)).toBe('PE_GROWTH')
    expect(lensFor('Infrastruktur', false)).toBe('EV_EBITDA')
    expect(lensFor('Energi', false)).toBe('EV_EBITDA_MIDCYCLE')
    expect(lensFor('Teknologi', false)).toBe('PS_GROWTH')
    expect(lensFor('Properti & Real Estat', false)).toBe('PB_YIELD')
  })
  it('switches any loss-maker to P/S', () => {
    expect(lensFor('Keuangan', true)).toBe('PS_GROWTH')
  })
})

describe('multipleOf', () => {
  it('computes EV/EBITDA from market cap + net debt', () => {
    expect(multipleOf('EV_EBITDA', base)).toBeCloseTo(11)   // (1000 + 200 − 100) / 100
  })
  it('uses multi-year average EBITDA for the mid-cycle lens', () => {
    const x = { ...base, annual: [{ ebitda: 300, pe: null, pb: null, ps: null, ev_ebitda: null, net_income: 1 }] }
    expect(multipleOf('EV_EBITDA_MIDCYCLE', x)).toBeCloseTo(1100 / 200)   // avg(100, 300)
  })
  it('refuses meaningless values', () => {
    expect(multipleOf('PE_GROWTH', { ...base, trailing_pe: -4 })).toBeNull()
    expect(multipleOf('EV_EBITDA', { ...base, ebitda: 0 })).toBeNull()
  })
})

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('valuate', () => {
  const peers = [bank('A', 1.0, 0.10), bank('B', 1.5, 0.12), bank('C', 2.0, 0.14)]

  it('flags a premium that quality justifies', () => {
    const r = valuate(bank('BBCA.JK', 3.0, 0.21), peers)
    expect(r.peers.verdict).toBe('premium')
    expect(r.peers.median).toBe(1.5)
    expect(r.quality.verdict).toBe('stronger')
    expect(r.read).toBe('premium backed by stronger ROE')
    expect(r.summary).toContain('P/B 3.0× · vs peers 1.5× (+100%, premium, n=3)')
  })

  it('flags a discount that weaker quality explains', () => {
    const r = valuate(bank('Y.JK', 1.0, 0.05), peers)
    expect(r.peers.verdict).toBe('discount')
    expect(r.read).toBe('discount reflects weaker ROE')
  })

  it('treats ±15% as on par', () => {
    expect(valuate(bank('Z.JK', 1.6, 0.12), peers).peers.verdict).toBe('on par')
  })

  it('needs at least three peers with data', () => {
    const r = valuate(bank('Q.JK', 2, 0.1), peers.slice(0, 2))
    expect(r.peers.verdict).toBe('insufficient peers')
    expect(r.read).toBe('not enough comparable peers')
  })

  it('compares against its own multi-year average', () => {
    const annual = [2.0, 2.2, 1.8, 2.0].map((pb) => ({ pb, pe: null, ps: null, ev_ebitda: null, ebitda: null, net_income: 1 }))
    const r = valuate({ ...bank('H.JK', 3.0, 0.2), annual }, peers)
    expect(r.own.avg).toBeCloseTo(2.0)
    expect(r.own.verdict).toBe('above')
    expect(r.own.diff).toBeCloseTo(0.5)
  })

  it('for leverage, lower is the stronger quality', () => {
    const coal = (t: string, debt: number): ValuationInput => ({ ...base, ticker: t, sector: 'Energi', total_debt: debt, total_cash: 0 })
    const r = valuate(coal('ADRO.JK', 0), [coal('P1', 200), coal('P2', 300), coal('P3', 400)])
    expect(r.lens).toBe('EV_EBITDA_MIDCYCLE')
    expect(r.quality.verdict).toBe('stronger')
  })
})
