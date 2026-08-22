// app/src/graph/signals.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

beforeEach(() => {
  process.env.SIGNAL_PRICE_MINOR = '3.0'
  process.env.SIGNAL_PRICE_MAJOR = '5.0'
  process.env.SIGNAL_VOLUME_MINOR = '1.5'
  process.env.SIGNAL_VOLUME_MAJOR = '3.0'
})

describe('classifySignal', () => {
  it('returns null below thresholds', async () => {
    const { classifySignal } = await import('./signals.js')
    expect(classifySignal(2.0, 1.0)).toBeNull()
  })

  it('MINOR PRICE_MOVE at 3.5%', async () => {
    const { classifySignal } = await import('./signals.js')
    const sig = classifySignal(3.5, 1.0)
    expect(sig?.signal_type).toBe('PRICE_MOVE')
    expect(sig?.tier).toBe('MINOR')
  })

  it('MAJOR PRICE_MOVE at 6%', async () => {
    const { classifySignal } = await import('./signals.js')
    const sig = classifySignal(6.0, 1.0)
    expect(sig?.tier).toBe('MAJOR')
  })

  it('VOLUME_SPIKE when volume ratio high', async () => {
    const { classifySignal } = await import('./signals.js')
    const sig = classifySignal(0.5, 2.0)
    expect(sig?.signal_type).toBe('VOLUME_SPIKE')
  })

  it('COMBINED when both triggered', async () => {
    const { classifySignal } = await import('./signals.js')
    const sig = classifySignal(4.0, 2.0)
    expect(sig?.signal_type).toBe('COMBINED')
  })
})

describe('filterCooledSignals', () => {
  const sig = (ticker: string) => ({
    ticker, signal_type: 'PRICE_MOVE' as const, tier: 'MAJOR' as const,
    value: 10, detected_at: new Date().toISOString(),
  })

  beforeEach(() => {
    process.env.SIGNAL_COOLDOWN_MIN = '60'
  })

  it('passes signals with no cooldown entry', async () => {
    const { filterCooledSignals } = await import('./signals.js')
    expect(filterCooledSignals([sig('RANS.JK')], {})).toHaveLength(1)
  })

  it('drops signals inside cooldown window', async () => {
    const { filterCooledSignals } = await import('./signals.js')
    const now = Date.now()
    const tenMinAgo = new Date(now - 10 * 60_000).toISOString()
    expect(filterCooledSignals([sig('RANS.JK')], { 'RANS.JK': tenMinAgo }, now)).toHaveLength(0)
  })

  it('passes signals after cooldown expires', async () => {
    const { filterCooledSignals } = await import('./signals.js')
    const now = Date.now()
    const hourAgo = new Date(now - 61 * 60_000).toISOString()
    expect(filterCooledSignals([sig('RANS.JK')], { 'RANS.JK': hourAgo }, now)).toHaveLength(1)
  })

  it('filters per ticker independently', async () => {
    const { filterCooledSignals } = await import('./signals.js')
    const now = Date.now()
    const recent = new Date(now - 5 * 60_000).toISOString()
    const out = filterCooledSignals([sig('RANS.JK'), sig('PRDL.JK')], { 'RANS.JK': recent }, now)
    expect(out.map(s => s.ticker)).toEqual(['PRDL.JK'])
  })
})
