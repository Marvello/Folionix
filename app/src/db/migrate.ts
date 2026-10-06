import { createHash } from 'node:crypto'
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
 * Highest migration that is already in EVERY database (and in db/schema.sql).
 * The runner never executes a file at or below it. Files up to it were removed
 * from db/migrations once every live ledger was confirmed complete (2026-10-06);
 * their content lives in schema.sql and git history.
 *
 * Bump this only once a migration has landed in every live database AND been
 * folded into schema.sql.
 */
export const SCHEMA_BASELINE = '039'

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

export interface MigrationStatus {
  pending: string[]
  applied: string[]
  /** Applied files edited since they ran (content no longer matches the recorded checksum). */
  modified: string[]
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>

/**
 * Compare each applied file with the checksum recorded for it. Rows from before
 * checksums existed are backfilled when `backfill` is set (the runner does; --check
 * only reads). Returns the files whose content changed after they were applied —
 * editing an applied migration never re-runs it, so the change silently never ships.
 */
async function reconcileChecksums(query: Query, dir: string, files: string[], backfill: boolean): Promise<string[]> {
  const { rows } = await query('select version, checksum from public.schema_migrations')
  const recorded = new Map<string, string | null>(rows.map((r: { version: string; checksum: string | null }) => [r.version, r.checksum]))
  const modified: string[] = []
  for (const f of files.filter(f => FILE_RE.test(f) && recorded.has(f.slice(0, 3))).sort()) {
    const sum = sha256(readFileSync(join(dir, f), 'utf8'))
    const prev = recorded.get(f.slice(0, 3))
    if (prev == null) {
      if (backfill) await query('update public.schema_migrations set checksum = $2 where version = $1 and checksum is null', [f.slice(0, 3), sum])
    } else if (prev !== sum) {
      modified.push(f)
    }
  }
  return modified
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
  const { rows: col } = await getPool().query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schema_migrations' and column_name = 'checksum'`)
  return {
    applied: files.filter(f => FILE_RE.test(f) && done.has(f.slice(0, 3))).sort(),
    pending: pendingFiles(files, done),
    modified: col.length ? await reconcileChecksums((t, p) => getPool().query(t, p), findMigrationsDir(), files, false) : [],
  }
}

/** Apply every pending migration. Returns the filenames applied, in order. */
export async function runPendingMigrations(): Promise<string[]> {
  const dir = findMigrationsDir()
  const client = await getPool().connect()
  const applied: string[] = []
  try {
    // The pool's 30s statement_timeout must not apply here: waiting for the lock,
    // or a long data migration, legitimately takes longer. Reset in finally.
    await client.query('set statement_timeout = 0')
    // Serialize: bot, graph and worker all start at once against the same DB.
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY])

    const { rows: reg } = await client.query(
      `select to_regclass('public.schema_migrations') is not null as present`)
    if (!reg[0]?.present) {
      throw new Error(
        'public.schema_migrations is missing — bootstrap the database with db/schema.sql first')
    }

    // The ledger belongs to this runner, so it maintains its own columns.
    await client.query('alter table public.schema_migrations add column if not exists checksum text')

    const { rows } = await client.query('select version from public.schema_migrations')
    const done = new Set<string>(rows.map((r: { version: string }) => r.version))
    const files = readdirSync(dir)

    const pending = pendingFiles(files, done)

    for (const file of pending) {
      const version = file.slice(0, 3)
      const sql = readFileSync(join(dir, file), 'utf8')
      // The runner owns the transaction; a file's own BEGIN/COMMIT would commit
      // half a migration and break atomicity.
      if (/^\s*(begin|commit)\s*;/im.test(sql)) {
        throw new Error(`migration ${file} must not contain BEGIN/COMMIT — the runner wraps each file in a transaction`)
      }
      await client.query('begin')
      try {
        // Fail fast instead of queueing behind a long web query while holding the
        // advisory lock that the other services are waiting on.
        await client.query(`set local lock_timeout = '10s'`)
        await client.query(sql)
        // Convention is that each file registers itself; this is the backstop
        // so a file that forgot its insert cannot re-run on every boot.
        await client.query(
          `insert into public.schema_migrations (version, name, checksum)
           values ($1, $2, $3) on conflict (version) do update set checksum = excluded.checksum`,
          [version, file.replace(/\.sql$/, ''), sha256(sql)])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback').catch(() => {})
        throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      console.log(`[migrate] applied ${file}`)
      applied.push(file)
    }

    const modified = await reconcileChecksums((t, p) => client.query(t, p), dir, files, true)
    for (const f of modified) {
      console.warn(`[migrate] WARNING ${f} was edited after it was applied — the edit never ran. Add a new migration instead.`)
    }
    return applied
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    await client.query('reset statement_timeout').catch(() => {})
    client.release()
  }
}

// CLI: `npm run migrate` applies pending, `npm run migrate -- --check` reports only.
if (process.argv[1]?.endsWith('migrate.js') || process.argv[1]?.endsWith('migrate.ts')) {
  const checkOnly = process.argv.includes('--check')
  const run = checkOnly
    ? checkMigrations().then(s => {
        console.log(`[migrate] ${s.applied.length} applied, ${s.pending.length} pending, ${s.modified.length} modified`)
        if (s.pending.length > 0) console.log(s.pending.map(f => `  pending: ${f}`).join('\n'))
        if (s.modified.length > 0) console.log(s.modified.map(f => `  modified after apply: ${f}`).join('\n'))
        if (s.pending.length > 0 || s.modified.length > 0) process.exitCode = 1
      })
    : runPendingMigrations().then(a => {
        console.log(a.length === 0 ? '[migrate] up to date' : `[migrate] applied ${a.length}`)
      })
  run.catch(err => {
    console.error('[migrate]', err instanceof Error ? err.message : err)
    process.exit(1)
  }).finally(() => getPool().end())
}
