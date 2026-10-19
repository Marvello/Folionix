import { describe, expect, it } from 'vitest'
import { applySettings } from './settings'

describe('applySettings', () => {
  it('overlays valid whitelisted rows and ignores the rest', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'keep' }
    applySettings([
      { key: 'GOLD_ALERT_PCT', value: '4.5' },
      { key: 'SIGNAL_COOLDOWN_MIN', value: 'abc' },   // invalid → ignored
      { key: 'DATABASE_URL', value: 'evil' },          // not whitelisted
    ], env)
    expect(env.GOLD_ALERT_PCT).toBe('4.5')
    expect(env.SIGNAL_COOLDOWN_MIN).toBeUndefined()
    expect(env.DATABASE_URL).toBe('keep')
  })

  it('removing a row restores the boot value', () => {
    const env: NodeJS.ProcessEnv = {}
    applySettings([{ key: 'CACHE_MINUTES', value: '5' }], env)
    expect(env.CACHE_MINUTES).toBe('5')
    applySettings([], env)
    expect(env.CACHE_MINUTES).toBe(process.env.CACHE_MINUTES)
  })
})
