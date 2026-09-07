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
// snapshot of 001–036 and registers all of them; this runner only ever takes
// it from there.

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

/** Migration files not yet in the ledger, in numeric order. */
export function pendingFiles(files: string[], applied: Set<string>): string[] {
  return files.filter(f => FILE_RE.test(f) && !applied.has(f.slice(0, 3))).sort()
}

export interface MigrationStatus {
  pending: string[]
  applied: string[]
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
    const pending = pendingFiles(readdirSync(dir), done)

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
