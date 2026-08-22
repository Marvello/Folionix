// app/src/graph/session.test.ts
import { describe, it, expect } from 'vitest'
import { detectSession } from './session'

describe('detectSession', () => {
  // toWib: create a Date representing a given WIB hour:minute on a weekday (Tuesday)
  // WIB = UTC+7, so WIB hour h = UTC hour (h - 7)
  const toWib = (h: number, m = 0) => {
    // Use a fixed Tuesday in UTC: 2024-01-02 is a Tuesday
    const d = new Date('2024-01-02T00:00:00Z')
    // Set UTC hours to (h - 7) to get WIB hour h
    d.setUTCHours(h - 7, m, 0, 0)
    return d
  }

  it('CLOSED before 8:45', () => expect(detectSession(toWib(8, 0))).toBe('CLOSED'))
  it('PRE_MARKET 8:45-9:00', () => expect(detectSession(toWib(8, 47))).toBe('PRE_MARKET'))
  it('SESSION_1 9:00-11:30', () => expect(detectSession(toWib(10, 0))).toBe('SESSION_1'))
  it('LUNCH 11:30-13:30', () => expect(detectSession(toWib(12, 0))).toBe('LUNCH'))
  it('SESSION_2 13:30-15:00', () => expect(detectSession(toWib(14, 0))).toBe('SESSION_2'))
  it('AFTER_HOURS 15:00-15:30', () => expect(detectSession(toWib(15, 15))).toBe('AFTER_HOURS'))
  it('CLOSED after 15:30', () => expect(detectSession(toWib(16, 0))).toBe('CLOSED'))
})
