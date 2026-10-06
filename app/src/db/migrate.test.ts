import { describe, it, expect } from 'vitest'
import { pendingFiles, findMigrationsDir, SCHEMA_BASELINE } from './migrate'

describe('pendingFiles', () => {
  const files = [
    '036_nextauth_tables.sql', '040_a.sql',
    '035_drop_rls.sql', 'README.md', '040_old_copy.sql.bak', 'notes.sql',
    '041_b.sql',
  ]

  it('returns only unapplied migrations above the baseline, in numeric order', () => {
    expect(pendingFiles(files, new Set(['035']))).toEqual([
      '040_a.sql',
      '041_b.sql',
    ])
  })

  it('never returns a file at or below the baseline, however empty the ledger', () => {
    // The regression: a DB bootstrapped from the old schema.sql has a ledger
    // holding only 034/036, which made the runner replay 001-033 and abort at
    // 003 on `role "authenticated" does not exist`.
    const all = ['001_a.sql', '003_price_refresh_requests.sql', '033_c.sql',
                 '035_drop_rls.sql', '036_nextauth_tables.sql', '040_d.sql']
    expect(pendingFiles(all, new Set(['034', '036']))).toEqual(['040_d.sql'])
    expect(pendingFiles(all, new Set())).toEqual(['040_d.sql'])
  })

  it('ignores non-migration files — a stray .bak must never be applied', () => {
    expect(pendingFiles(files, new Set())).not.toContain('040_old_copy.sql.bak')
    expect(pendingFiles(files, new Set())).not.toContain('notes.sql')
  })

  it('is empty when the ledger is current', () => {
    expect(pendingFiles(files, new Set(['035', '036', '040', '041']))).toEqual([])
  })
})

describe('SCHEMA_BASELINE', () => {
  it('matches the newest migration folded into schema.sql and live everywhere', () => {
    expect(SCHEMA_BASELINE).toBe('039')
  })

  it('no file at or below the baseline is left in db/migrations', async () => {
    const { readdirSync } = await import('node:fs')
    const stale = readdirSync(findMigrationsDir()).filter(f => /^\d{3}_/.test(f) && f.slice(0, 3) <= SCHEMA_BASELINE)
    expect(stale).toEqual([])
  })
})

describe('findMigrationsDir', () => {
  it('walks up from the cwd to the repo db/migrations', () => {
    // Tests run with cwd = app/, so this must climb one level.
    expect(findMigrationsDir().endsWith('db/migrations')).toBe(true)
  })

  it('honours MIGRATIONS_DIR and rejects a bad override', () => {
    const prev = process.env['MIGRATIONS_DIR']
    process.env['MIGRATIONS_DIR'] = '/nope/does/not/exist'
    try {
      expect(() => findMigrationsDir()).toThrow(/does not exist/)
    } finally {
      if (prev === undefined) delete process.env['MIGRATIONS_DIR']
      else process.env['MIGRATIONS_DIR'] = prev
    }
  })
})
