import { describe, it, expect } from 'vitest'
import { pendingFiles, findMigrationsDir } from './migrate'

describe('pendingFiles', () => {
  const files = [
    '036_nextauth_tables.sql', '037_accuracy_benchmark_relative.sql',
    '035_drop_rls.sql', 'README.md', '037_old_copy.sql.bak', 'notes.sql',
  ]

  it('returns only unapplied migrations, in numeric order', () => {
    expect(pendingFiles(files, new Set(['035']))).toEqual([
      '036_nextauth_tables.sql', '037_accuracy_benchmark_relative.sql',
    ])
  })

  it('ignores non-migration files — a stray .bak must never be applied', () => {
    expect(pendingFiles(files, new Set())).not.toContain('037_old_copy.sql.bak')
    expect(pendingFiles(files, new Set())).not.toContain('notes.sql')
  })

  it('is empty when the ledger is current', () => {
    expect(pendingFiles(files, new Set(['035', '036', '037']))).toEqual([])
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
