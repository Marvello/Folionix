import { describe, expect, it } from 'vitest'
import { SETTINGS, validateCombination, validateSetting } from './settings'

describe('validateSetting', () => {
  it('normalises valid values', () => {
    expect(validateSetting('SEND_TELEGRAM', ' FALSE ')).toBe('false')
    expect(validateSetting('SIGNAL_PRICE_MAJOR', '5.0')).toBe('5')
    expect(validateSetting('BOND_REG_CHECK_HOURS_WIB', '15, 9,9')).toBe('9,15')
    expect(validateSetting('PERSONAS', 'Buffett, lynch')).toBe('buffett,lynch')
    expect(validateSetting('PERSONAS', 'ALL')).toBe('all')
    expect(validateSetting('PERSONAS', '4')).toBe('4')
    expect(validateSetting('REC_STABILITY_PCT', '0')).toBe('0')
    expect(validateSetting('LLM_MODEL', 'qwen2.5:14b')).toBe('qwen2.5:14b')
  })

  it('rejects bad values with a readable message', () => {
    expect(() => validateSetting('DATABASE_URL', 'x')).toThrow(/Unknown setting/)
    expect(() => validateSetting('SEND_TELEGRAM', 'yes')).toThrow(/on or off/)
    expect(() => validateSetting('SIGNAL_COOLDOWN_MIN', '1.5')).toThrow(/whole number/)
    expect(() => validateSetting('FUNDAMENTALS_HOUR_WIB', '24')).toThrow(/at most 23/)
    expect(() => validateSetting('GRAPH_ANALYSIS_INTERVAL', 'abc')).toThrow(/number/)
    expect(() => validateSetting('BOND_REG_CHECK_HOURS_WIB', '9,25')).toThrow(/0–23/)
    expect(() => validateSetting('PERSONAS', 'buffett,soros')).toThrow(/soros/)
    expect(() => validateSetting('PERSONAS', '13')).toThrow(/1–12/)
    expect(() => validateSetting('LLM_MODEL', 'two words')).toThrow()
    expect(() => validateSetting('GOLD_ALERT_PCT', '')).toThrow(/required/)
  })

  it('every setting has a help text and a valid default (where literal)', () => {
    for (const s of SETTINGS) {
      expect(s.help.length, s.key).toBeGreaterThan(60)
      if (!/ /.test(s.default)) expect(() => validateSetting(s.key, s.default), s.key).not.toThrow()
    }
  })
})

describe('validateCombination', () => {
  it('requires minor < major', () => {
    expect(() => validateCombination({})).not.toThrow()
    expect(() => validateCombination({ SIGNAL_PRICE_MINOR: '6' })).toThrow(/Price move/)
    expect(() => validateCombination({ SIGNAL_VOLUME_MAJOR: '1.5' })).toThrow(/Volume spike/)
  })

  it('min persona votes cannot exceed enabled personas', () => {
    expect(() => validateCombination({ CONSENSUS_MIN_PERSONAS: '6' })).not.toThrow()
    expect(() => validateCombination({ CONSENSUS_MIN_PERSONAS: '7' })).toThrow(/6 enabled/)
    expect(() => validateCombination({ CONSENSUS_MIN_PERSONAS: '3', PERSONAS: 'buffett,lynch' })).toThrow(/2 enabled/)
    expect(() => validateCombination({ CONSENSUS_MIN_PERSONAS: '12', PERSONAS: 'all' })).not.toThrow()
  })
})
