import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.HEARTBEAT_FILE = join(mkdtempSync(join(tmpdir(), 'hb-')), 'beat')
const { beat, isFresh } = await import('./heartbeat')

describe('heartbeat', () => {
  it('is stale before the first beat, fresh after, stale once old', () => {
    expect(isFresh(60)).toBe(false)
    beat()
    expect(isFresh(60)).toBe(true)
    expect(isFresh(60, Date.now() + 61_000)).toBe(false)
  })
})
