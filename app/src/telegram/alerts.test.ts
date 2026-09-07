import { describe, it, expect } from 'vitest'
import { evaluateAlert } from './alerts'

const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()

const prevWithSameRec = {
  recommendation: 'HOLD',
  analysed_at: recentTime,
} as any

const prevWithDiffRec = {
  recommendation: 'BUY',
  analysed_at: recentTime,
} as any

describe('evaluateAlert', () => {
  it('isSame when recommendation unchanged and same day', () => {
    const r = evaluateAlert(prevWithSameRec, 'HOLD', new Date())
    expect(r.isSame).toBe(true)
    expect(r.recChanged).toBe(false)
  })

  it('not isSame when recommendation changes', () => {
    const r = evaluateAlert(prevWithDiffRec, 'HOLD', new Date())
    expect(r.isSame).toBe(false)
    expect(r.recChanged).toBe(true)
  })

  it('not isSame when new day', () => {
    const prevYesterday = { recommendation: 'HOLD', analysed_at: yesterday } as any
    const r = evaluateAlert(prevYesterday, 'HOLD', new Date())
    expect(r.isSame).toBe(false)
    expect(r.newDay).toBe(true)
  })

  it('isSame when no previous snapshot', () => {
    const r = evaluateAlert(null, 'HOLD', new Date())
    expect(r.isSame).toBe(false)
  })

  it('not isSame when recommendation is UNKNOWN', () => {
    const r = evaluateAlert(prevWithSameRec, 'UNKNOWN', new Date())
    expect(r.isSame).toBe(false)
  })

  it('newDay true when no analysed_at', () => {
    const prevNoTimestamp = { recommendation: 'HOLD' } as any
    const r = evaluateAlert(prevNoTimestamp, 'HOLD', new Date())
    expect(r.newDay).toBe(true)
    expect(r.isSame).toBe(false)
  })
})

describe('shouldReanalyze', () => {
  const now = new Date('2026-09-03T08:00:00Z')
  const at = (h: number) => ({ analysed_at: new Date(now.getTime() - h * 3_600_000).toISOString() })

  it('runs when there is no prior call', async () => {
    const { shouldReanalyze } = await import('./alerts.js')
    expect(shouldReanalyze(null, null, 4420, 0.02, 72, now).reanalyze).toBe(true)
  })

  it('skips a flat, fresh ticker — the BMRI flip-flop case', async () => {
    const { shouldReanalyze } = await import('./alerts.js')
    // 15 min after a call at 4420, price 4410: 0.23% move
    expect(shouldReanalyze(at(0.25), 4420, 4410, 0.02, 72, now).reanalyze).toBe(false)
  })

  it('still skips across a WIB day boundary while price is flat', async () => {
    const { shouldReanalyze } = await import('./alerts.js')
    expect(shouldReanalyze(at(30), 4420, 4430, 0.02, 72, now).reanalyze).toBe(false)
  })

  it('runs once price clears the stability threshold', async () => {
    const { shouldReanalyze } = await import('./alerts.js')
    expect(shouldReanalyze(at(4), 4250, 4420, 0.02, 72, now).reanalyze).toBe(true)
  })

  it('runs when the call goes stale even if price never moved', async () => {
    const { shouldReanalyze } = await import('./alerts.js')
    expect(shouldReanalyze(at(80), 4420, 4420, 0.02, 72, now).reanalyze).toBe(true)
  })

  it('runs when price is unavailable rather than silently holding', async () => {
    const { shouldReanalyze } = await import('./alerts.js')
    expect(shouldReanalyze(at(1), null, 4420, 0.02, 72, now).reanalyze).toBe(true)
  })
})
