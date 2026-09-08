import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getPool } from './db.js'

// ── MIGRATION RUNNER ──
//
// Applies any db/migrations/NNN_*.sql whose version is not yet in
// public.schema_migrations, in numeric order, each in its own transaction.
//
// It refuses to bootstrap. An empty or absent ledger means the database was
// never seeded from db/schema.sql, and replaying from 001 would abort at
// migration 003 — migrations 003–033 predate 035_drop_rls and still contain
// Supabase-only constructs (`to authenticated`, `auth.role()`, `revoke ...
// from anon`) that fail on plain Postgres. schema.sql is the consolidated
// snapshot of 001–039 and registers all of them; this runner only ever takes
// it from there.

/**
 * Highest migration that is already in EVERY database. Everything at or below
 * this is present by definition, so the runner never executes those files — it
 * only backfills their ledger rows.
 *
 * The rule is "already in every database", NOT "highest number in schema.sql".
 * db/schema.sql is the snapshot of 001-039, but 039 has not been applied to any
 * existing database yet, so the baseline stays at 038: a fresh bootstrap gets
 * 039 from schema.sql (which also inserts its ledger row, so pendingFiles skips
 * it), and an existing database has no 039 row and executes the file. Setting
 * the baseline to 039 would record it without ever running the DDL.
 *
 * This is not a belt-and-braces check, it is load-bearing: schema.sql shipped
 * for a long time registering only '034' and '036', so a database bootstrapped
 * from it has a ledger full of holes. Trusting the ledger alone made the runner
 * replay from 001 and abort at 003 with `role "authenticated" does not exist` —
 * migrations 003-033 predate 035_drop_rls and are not runnable on plain Postgres.
 *
 * Bump this only once a migration has landed in every live database.
 */
export const SCHEMA_BASELINE = '038'

/** Advisory-lock key, arbitrary but stable — serializes concurrent starts. */
const LOCK_KEY = 43_370_037

const FILE_RE = /^(\d{3})_[A-Za-z0-9_]+\.sql$/

/** Walk up from cwd looking for db/migrations — works from repo root, app/, and /app in the image. */
export function findMigrationsDir(): string {
  const override = process.env.MIGRATIONS_DIR
  if (override) {
    if (!existsSync(override)) throw new Error(`MIGRATIONS_DIR does not exist: ${override}`)
    return override
  }
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'db', 'migrations')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('db/migrations not found — set MIGRATIONS_DIR')
}

/** Migration files above the schema.sql baseline that are not yet in the ledger. */
export function pendingFiles(files: string[], applied: Set<string>): string[] {
  return files
    .filter(f => FILE_RE.test(f) && f.slice(0, 3) > SCHEMA_BASELINE && !applied.has(f.slice(0, 3)))
    .sort()
}

/** Files at or below the baseline missing from the ledger — recorded, never executed. */
export function baselineGaps(files: string[], applied: Set<string>): string[] {
  return files
    .filter(f => FILE_RE.test(f) && f.slice(0, 3) <= SCHEMA_BASELINE && !applied.has(f.slice(0, 3)))
    .sort()
}

export interface MigrationStatus {
  pending: string[]
  applied: string[]
  /** At/below baseline but unrecorded — a ledger hole, not work to do. */
  baselineGaps: string[]
}

/** Read-only check: which migration files are not yet in the ledger. */
export async function checkMigrations(): Promise<MigrationStatus> {
  const files = readdirSync(findMigrationsDir())

  const { rows: reg } = await getPool().query(
    `select to_regclass('public.schema_migrations') is not null as present`)
  if (!reg[0]?.present) {
    throw new Error(
      'public.schema_migrations is missing — bootstrap the database with db/schema.sql first')
  }

  const { rows } = await getPool().query('select version from public.schema_migrations')
  const done = new Set<string>(rows.map((r: { version: string }) => r.version))
  return {
    applied: files.filter(f => FILE_RE.test(f) && done.has(f.slice(0, 3))).sort(),
    pending: pendingFiles(files, done),
    baselineGaps: baselineGaps(files, done),
  }
}

/** Apply every pending migration. Returns the filenames applied, in order. */
export async function runPendingMigrations(): Promise<string[]> {
  const dir = findMigrationsDir()
  const client = await getPool().connect()
  const applied: string[] = []
  try {
    // Serialize: bot, graph and worker all start at once against the same DB.
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY])

    const { rows: reg } = await client.query(
      `select to_regclass('public.schema_migrations') is not null as present`)
    if (!reg[0]?.present) {
      throw new Error(
        'public.schema_migrations is missing — bootstrap the database with db/schema.sql first')
    }

    const { rows } = await client.query('select version from public.schema_migrations')
    const done = new Set<string>(rows.map((r: { version: string }) => r.version))
    const files = readdirSync(dir)

    // Close ledger holes left by older schema.sql snapshots. Recorded only —
    // these files are already contained in schema.sql and must never execute.
    const gaps = baselineGaps(files, done)
    if (gaps.length > 0) {
      await client.query(
        `insert into public.schema_migrations (version, name)
         select * from unnest($1::varchar[], $2::text[])
         on conflict (version) do nothing`,
        [gaps.map(f => f.slice(0, 3)), gaps.map(f => f.replace(/\.sql$/, ''))])
      console.log(`[migrate] recorded ${gaps.length} pre-baseline migration(s) already in schema.sql`)
    }

    const pending = pendingFiles(files, done)

    for (const file of pending) {
      const version = file.slice(0, 3)
      const sql = readFileSync(join(dir, file), 'utf8')
      await client.query('begin')
      try {
        await client.query(sql)
        // Convention is that each file registers itself; this is the backstop
        // so a file that forgot its insert cannot re-run on every boot.
        await client.query(
          `insert into public.schema_migrations (version, name)
           values ($1, $2) on conflict (version) do nothing`,
          [version, file.replace(/\.sql$/, '')])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback').catch(() => {})
        throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      console.log(`[migrate] applied ${file}`)
      applied.push(file)
    }
    return applied
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
  }
}

// CLI: `npm run migrate` applies pending, `npm run migrate -- --check` reports only.
if (process.argv[1]?.endsWith('migrate.js') || process.argv[1]?.endsWith('migrate.ts')) {
  const checkOnly = process.argv.includes('--check')
  const run = checkOnly
    ? checkMigrations().then(s => {
        console.log(`[migrate] ${s.applied.length} applied, ${s.pending.length} pending`)
        if (s.pending.length > 0) {
          console.log(s.pending.map(f => `  pending: ${f}`).join('\n'))
          process.exitCode = 1
        }
      })
    : runPendingMigrations().then(a => {
        console.log(a.length === 0 ? '[migrate] up to date' : `[migrate] applied ${a.length}`)
      })
  run.catch(err => {
    console.error('[migrate]', err instanceof Error ? err.message : err)
    process.exit(1)
  }).finally(() => getPool().end())
}
