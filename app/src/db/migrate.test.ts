import { describe, it, expect } from 'vitest'
import { pendingFiles, baselineGaps, findMigrationsDir, SCHEMA_BASELINE } from './migrate'

describe('pendingFiles', () => {
  const files = [
    '036_nextauth_tables.sql', '037_accuracy_benchmark_relative.sql',
    '035_drop_rls.sql', 'README.md', '037_old_copy.sql.bak', 'notes.sql',
    '038_restore_latest_analyses_invoker.sql',
  ]

  it('returns only unapplied migrations above the baseline, in numeric order', () => {
    expect(pendingFiles(files, new Set(['035']))).toEqual([
      '037_accuracy_benchmark_relative.sql',
      '038_restore_latest_analyses_invoker.sql',
    ])
  })

  it('never returns a file at or below the baseline, however empty the ledger', () => {
    // The regression: a DB bootstrapped from the old schema.sql has a ledger
    // holding only 034/036, which made the runner replay 001-033 and abort at
    // 003 on `role "authenticated" does not exist`.
    const all = ['001_a.sql', '003_price_refresh_requests.sql', '033_c.sql',
                 '035_drop_rls.sql', '036_nextauth_tables.sql', '037_d.sql']
    expect(pendingFiles(all, new Set(['034', '036']))).toEqual(['037_d.sql'])
    expect(pendingFiles(all, new Set())).toEqual(['037_d.sql'])
  })

  it('ignores non-migration files — a stray .bak must never be applied', () => {
    expect(pendingFiles(files, new Set())).not.toContain('037_old_copy.sql.bak')
    expect(pendingFiles(files, new Set())).not.toContain('notes.sql')
  })

  it('is empty when the ledger is current', () => {
    expect(pendingFiles(files, new Set(['035', '036', '037', '038']))).toEqual([])
  })
})

describe('baselineGaps', () => {
  it('reports unrecorded pre-baseline files so the ledger can be backfilled', () => {
    const all = ['001_a.sql', '003_b.sql', '036_c.sql', '037_d.sql']
    expect(baselineGaps(all, new Set(['034', '036']))).toEqual(['001_a.sql', '003_b.sql'])
  })

  it('is empty once the ledger is whole, and never overlaps pendingFiles', () => {
    const all = ['001_a.sql', '036_c.sql', '037_d.sql']
    const done = new Set(['001', '036'])
    expect(baselineGaps(all, done)).toEqual([])
    const overlap = baselineGaps(all, new Set()).filter(f => pendingFiles(all, new Set()).includes(f))
    expect(overlap).toEqual([])
  })

  it('keeps the baseline in step with what schema.sql folds in', () => {
    expect(SCHEMA_BASELINE).toBe('036')
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
