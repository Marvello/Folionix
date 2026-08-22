import { describe, it, expect } from 'vitest'
import {
  safeFloat, fmtIdr, fmtCap, calcPnl, pnlIcon,
  normalizeTicker, sanitizeHtml, valueHolding, wibDateOffset,
} from './format'

describe('safeFloat', () => {
  it('returns null for null/undefined/NaN', () => {
    expect(safeFloat(null)).toBeNull()
    expect(safeFloat(undefined)).toBeNull()
    expect(safeFloat(NaN)).toBeNull()
    expect(safeFloat('not a number')).toBeNull()
  })
  it('rounds to given decimals', () => {
    expect(safeFloat(1.2345, 2)).toBe(1.23)
    expect(safeFloat('3.14')).toBe(3.14)
  })
})

describe('fmtIdr', () => {
  it('formats with Indonesian thousand separator (dot)', () => {
    expect(fmtIdr(1234567)).toBe('Rp 1.234.567')
    expect(fmtIdr(0)).toBe('Rp 0')
  })
})

describe('fmtCap', () => {
  it('abbreviates to T/B/M', () => {
    expect(fmtCap(1.5e12)).toBe('Rp 1,50T')
    expect(fmtCap(450e9)).toBe('Rp 450,00B')
    expect(fmtCap(12e6)).toBe('Rp 12,00M')
  })
  it('returns Rp 0 for falsy', () => {
    expect(fmtCap(0)).toBe('Rp 0')
  })
})

describe('calcPnl', () => {
  it('computes P&L correctly (1 lot = 100 shares)', () => {
    const result = calcPnl(1100, 1000, 10)
    expect(result.invested).toBe(1_000_000)   // 1000 * 10 * 100
    expect(result.totalPnl).toBe(100_000)      // (1100-1000) * 10 * 100
    expect(result.pnl).toBe(100)               // price diff per share
    expect(result.pnlPct).toBeCloseTo(10)      // 10%
  })
  it('handles loss', () => {
    const result = calcPnl(900, 1000, 5)
    expect(result.totalPnl).toBe(-50_000)
    expect(result.pnlPct).toBeCloseTo(-10)
  })
})

describe('pnlIcon', () => {
  it('returns correct icon', () => {
    expect(pnlIcon(5)).toBe('🟢 PROFIT')
    expect(pnlIcon(0)).toBe('⚪ BREAKEVEN')
    expect(pnlIcon(-3)).toBe('🟡 SMALL LOSS')
    expect(pnlIcon(-10)).toBe('🔴 LOSS')
  })
})

describe('normalizeTicker', () => {
  it('appends .JK', () => {
    expect(normalizeTicker('BBCA')).toBe('BBCA.JK')
  })
  it('leaves .JK suffix alone', () => {
    expect(normalizeTicker('BBCA.JK')).toBe('BBCA.JK')
  })
  it('maps IHSG to ^JKSE', () => {
    expect(normalizeTicker('IHSG')).toBe('^JKSE')
  })
  it('leaves ^ prefix alone', () => {
    expect(normalizeTicker('^JKSE')).toBe('^JKSE')
  })
})

describe('sanitizeHtml', () => {
  it('strips disallowed tags', () => {
    expect(sanitizeHtml('<b>bold</b><script>evil()</script>')).toBe('<b>bold</b>')
  })
})

describe('valueHolding', () => {
  it('computes valuation', () => {
    const v = valueHolding(100, 1000, 1200)
    expect(v.cost).toBe(100_000)
    expect(v.currentValue).toBe(120_000)
    expect(v.pnl).toBe(20_000)
    expect(v.pnlPct).toBeCloseTo(20)
    expect(v.statusEmoji).toBe('🟢 PROFIT')
  })
})

describe('wibDateOffset', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(wibDateOffset(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('tomorrow is one day after today (WIB)', () => {
    const today = new Date(wibDateOffset(0) + 'T00:00:00Z').getTime()
    const tomorrow = new Date(wibDateOffset(1) + 'T00:00:00Z').getTime()
    expect(tomorrow - today).toBe(86_400_000)
  })
})
