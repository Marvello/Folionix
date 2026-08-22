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
