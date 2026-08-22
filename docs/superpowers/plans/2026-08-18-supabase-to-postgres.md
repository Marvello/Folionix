# Supabase → Standard Postgres Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop Supabase dependency from Folionix, extract a reusable DB package (`@marvello/common-tech`), use NextAuth for authentication. Vitalix stays untouched — will adopt the same stack when it migrates from Express to Next.js later.

**Architecture:** `@marvello/common-tech` provides DB client + migration runner (no auth — that's NextAuth's job). Folionix backend rewrites ~50 PostgREST queries to parameterized SQL. Folionix web replaces Supabase Auth with NextAuth (credentials provider) and client-component mutations become Next.js Server Actions.

**Tech Stack:** `pg` (node-postgres), NextAuth/Auth.js (credentials provider + pg adapter), TypeScript (ESM)

**Spec:** This plan. No separate spec doc — requirements derived from existing Folionix CLAUDE.md + codebase exploration.

## Global Constraints

- Node 24 (Folionix)
- ESM everywhere (`"type": "module"`)
- All timestamps UTC, displayed in WIB
- Snake_case DB columns, camelCase TypeScript
- No ORM — raw parameterized SQL (`$1, $2, ...`)
- Auth via NextAuth (credentials provider, email+password)
- Supabase RLS removed; auth enforcement via NextAuth session + Next.js middleware
- `@marvello/common-tech` published to GitHub Packages (DB client + migrations only, no auth)

---

## Phase 1: Create @marvello/common-tech

> **STATUS: DONE** — Package created at `~/Project/common-tech/`. DB client + migration runner implemented and tested. Auth removed (NextAuth handles auth). Git initialized, ready to push.

### Task 1: Package Scaffold + DB Client + Migration Runner ✅

**Exports:**
- `@marvello/common-tech` → `createPool`, `query`, `withTransaction`, `runMigrations`
- `@marvello/common-tech/client` → `createPool`, `query`, `withTransaction`
- `@marvello/common-tech/migrate` → `runMigrations`

No auth module — NextAuth handles auth for Next.js projects.

### Task 2: Publish to GitHub Packages

- [ ] **Step 1: Create GitHub repo**

```bash
cd ~/Project/common-tech
gh repo create marvellooni/common-tech --private --source=. --push
```

- [ ] **Step 2: Create publish workflow**

`.github/workflows/publish.yml`: on tag push `v*`, `npm run build` + `npm publish`.

- [ ] **Step 3: Tag and push**

```bash
git tag v0.1.0
git push origin main --tags
```

- [ ] **Step 4: Verify package visible on GitHub Packages**

---

## Phase 2: Migrate Folionix Backend

### Task 3: Replace app/src/db/db.ts with pg Queries

**Files:**
- Modify: `app/src/db/db.ts` (full rewrite — ~50 functions)
- Modify: `app/package.json` (add `pg`, `@marvello/common-tech`; remove `@supabase/supabase-js`)
- Test: `app/src/db/__tests__/db.test.ts`

**Interfaces:**
- Consumes: `createPool`, `query`, `withTransaction` from common-tech
- Produces: same ~50 function signatures as current db.ts (all callers unchanged)

The key insight: every function signature stays identical. Only the implementation changes from PostgREST to parameterized SQL. All callers import from `../db/db.js` and see no difference.

**Query pattern translation reference:**

| Supabase PostgREST | pg parameterized SQL |
|---|---|
| `.from('t').select('*').eq('col', val)` | `SELECT * FROM t WHERE col = $1` |
| `.from('t').select('*').eq('a', v1).order('b')` | `SELECT * FROM t WHERE a = $1 ORDER BY b` |
| `.from('t').insert({...}).select('id').single()` | `INSERT INTO t (...) VALUES (...) RETURNING id` |
| `.from('t').upsert({...}, { onConflict: 'col' })` | `INSERT INTO t (...) VALUES (...) ON CONFLICT (col) DO UPDATE SET ...` |
| `.from('t').update({...}).eq('col', val)` | `UPDATE t SET ... WHERE col = $1` |
| `.from('t').delete().eq('col', val)` | `DELETE FROM t WHERE col = $1` |
| `.rpc('fn', { arg: val })` | `SELECT * FROM fn($1)` |
| `.maybeSingle()` | `LIMIT 1` + return `rows[0] ?? null` |
| `.range(from, to)` | `LIMIT $1 OFFSET $2` |
| `.in('col', arr)` | `WHERE col = ANY($1)` (pass array) |
| `.gte('col', val)` | `WHERE col >= $1` |
| `.is('col', null)` | `WHERE col IS NULL` |

- [ ] **Step 1: Install deps**

```bash
cd app
npm install pg @marvello/common-tech
npm install -D @types/pg
npm uninstall @supabase/supabase-js
```

- [ ] **Step 2: Rewrite db.ts — pool init + PORTFOLIO section**

Replace the Supabase client singleton with pg Pool:

```typescript
import pg from 'pg'
import { createPool } from '@marvello/common-tech/client'
import type { PositionRow, StockTransactionRow, /* ... */ } from '../../../lib/types.js'

let _pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL required')
    _pool = createPool({ connectionString: url })
  }
  return _pool
}

export async function upsertPosition(
  ticker: string, avgPrice: number, lots: number, notes: string | null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO portfolio_positions (ticker, avg_price, lots, notes, active, updated_at)
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT (ticker) DO UPDATE SET avg_price = $2, lots = $3, notes = $4, active = true, updated_at = now()`,
    [ticker, avgPrice, lots, notes]
  )
}

export async function deactivatePosition(ticker: string): Promise<void> {
  await getPool().query(
    'UPDATE portfolio_positions SET active = false, updated_at = now() WHERE ticker = $1',
    [ticker]
  )
}

export async function getAllPositions(): Promise<PositionRow[]> {
  const { rows } = await getPool().query(
    'SELECT * FROM portfolio_positions WHERE active = true ORDER BY ticker'
  )
  return rows as PositionRow[]
}
```

Pattern: each function replaces the supabase chain with a `pool.query(sql, params)` call. Return `rows` instead of `data`. Throw on error (pg throws automatically on query failure — no need for manual error checks).

- [ ] **Step 3: Rewrite remaining sections**

Apply the same pattern to all sections: SNAPSHOTS (~6 functions), ANALYSES (~2), GOLD (~4), FUNDS (~6), BONDS (~6), DIVIDEND SCHEDULE (~3), WATCHLIST (~3), NEWS CACHE (~5), WEEKLY REVIEW (~7), SYSTEM (~1), ANALYSIS JOBS (~8).

Notable translations:
- `getSnapshotPricesSince` pagination: replace PostgREST `.range()` with `LIMIT/OFFSET` loop (or single query since pg has no `max-rows` cap — the PostgREST pagination was working around a PostgREST limit that doesn't apply to direct pg)
- `claimAnalysisJob` RPC: `SELECT * FROM claim_analysis_job($1)` 
- `recommendationAccuracy` RPC: `SELECT * FROM recommendation_accuracy($1)`
- Batch upserts (e.g., `upsertFundCatalog`, `upsertBondCouponSchedule`): use `unnest` or loop inserts in a transaction

- [ ] **Step 4: Update env vars**

In `.env` and all Docker/CI configs, replace:
- `SUPABASE_URL` → remove
- `SUPABASE_SERVICE_KEY` → remove
- Add: `DATABASE_URL=postgres://user:pass@host:5432/folionix`

- [ ] **Step 5: Run typecheck + tests**

```bash
cd app
npm run typecheck
npm test
```

- [ ] **Step 6: Manual smoke test**

```bash
npm run prices -- BBCA
npm run portfolio
```

- [ ] **Step 7: Commit**

```bash
git add app/src/db/db.ts app/package.json app/package-lock.json
git commit -m "refactor: replace supabase-js with pg in backend"
```

---

### Task 4: Drop Supabase RLS + Add NextAuth Tables

**Files:**
- Create: `supabase/migrations/NNN_drop_rls.sql`
- Create: `supabase/migrations/NNN_nextauth_tables.sql`
- Modify: `supabase/schema.sql` (remove RLS policies + Supabase-specific grants)

- [ ] **Step 1: Create migration to drop Supabase RLS**

```sql
-- Drop all RLS policies (they reference auth.uid() which no longer exists)
-- Drop Supabase-specific grants (anon, authenticated roles)
-- Keep all tables, views, functions, triggers intact
```

List all `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` statements from schema.sql and generate corresponding `DROP POLICY` + `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` statements.

- [ ] **Step 2: Create NextAuth tables migration**

NextAuth with `@auth/pg-adapter` requires these tables: `users`, `accounts`, `sessions`, `verification_tokens`. The adapter auto-creates them, or we can create manually for control.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: drop Supabase RLS, add NextAuth tables"
```

---

## Phase 3: Migrate Folionix Web

### Task 5: Set Up NextAuth + Replace Web Auth

**Files:**
- Create: `web/lib/auth.ts` (NextAuth config)
- Create: `web/app/api/auth/[...nextauth]/route.ts` (NextAuth API route)
- Create: `web/lib/db.ts` (pg pool singleton)
- Modify: `web/proxy.ts` (replace Supabase auth with NextAuth session check)
- Modify: `web/app/login/page.tsx` (replace Supabase signIn with NextAuth signIn)
- Delete: `web/lib/supabase/client.ts`, `web/lib/supabase/server.ts`
- Modify: `web/package.json` (add `next-auth`, `@auth/pg-adapter`, `pg`; remove `@supabase/ssr`, `@supabase/supabase-js`)

- [ ] **Step 1: Install deps**

```bash
cd web
npm install next-auth@beta @auth/pg-adapter pg @marvello/common-tech
npm uninstall @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Create web/lib/db.ts**

```typescript
import pg from 'pg'
import { createPool } from '@marvello/common-tech/client'

let _pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = createPool({
      connectionString: process.env.DATABASE_URL!,
      max: 5,
    })
  }
  return _pool
}
```

- [ ] **Step 3: Create web/lib/auth.ts**

```typescript
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { Pool } from 'pg'
import { getPool } from './db'
import bcrypt from 'bcrypt'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const { email, password } = credentials as { email: string; password: string }
        const { rows } = await getPool().query(
          'SELECT id, email, password_hash, name FROM nextauth_users WHERE email = $1',
          [email],
        )
        const user = rows[0]
        if (!user) return null
        const valid = await bcrypt.compare(password, user.password_hash)
        if (!valid) return null
        return { id: String(user.id), email: user.email, name: user.name }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
})
```

- [ ] **Step 4: Create NextAuth API route**

`web/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 5: Rewrite proxy.ts**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'

export async function proxy(request: NextRequest) {
  const session = await auth()
  const path = request.nextUrl.pathname
  const isPublic = path.startsWith('/login') || path.startsWith('/api/auth')

  if (!session && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 6: Update login/page.tsx**

Replace `supabase.auth.signInWithPassword` with NextAuth's `signIn('credentials', { email, password })`.

- [ ] **Step 7: Create admin seed script**

```bash
# Script to hash password and insert into nextauth_users
node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],12).then(h=>console.log(h))" "password" | \
  psql $DATABASE_URL -c "INSERT INTO nextauth_users (email, password_hash, name) VALUES ('admin@example.com', '...', 'Admin')"
```

- [ ] **Step 8: Set env vars**

Add to `.env`: `AUTH_SECRET` (NextAuth requires this), `DATABASE_URL`.

- [ ] **Step 9: Verify login flow**

```bash
cd web && npm run dev
```
Test: visit `/` → redirect to `/login` → enter creds → dashboard loads.

- [ ] **Step 10: Commit**

```bash
git add web/
git commit -m "refactor: replace Supabase auth with NextAuth credentials"
```

---

### Task 6: Replace Server Component Queries

**Files:**
- Modify: `web/app/page.tsx` (dashboard)
- Modify: `web/app/stocks/page.tsx`
- Modify: `web/app/gold/page.tsx`
- Modify: `web/app/funds/page.tsx`
- Modify: `web/app/bonds/page.tsx`
- Modify: `web/app/news/page.tsx`
- Modify: `web/app/reviews/page.tsx`

**Interfaces:**
- Consumes: `getPool()` from `web/lib/db.ts`
- Produces: same page props (data shapes unchanged)

Pattern: replace every `supabase.from("table").select("cols").eq("col", val)` with `pool.query("SELECT cols FROM table WHERE col = $1", [val])`.

- [ ] **Step 1: Rewrite dashboard page.tsx**

Replace ~17 parallel Supabase queries with parallel `pool.query()` calls. Use `Promise.all()` as before.

Example (one of 17):
```typescript
// Before
supabase.from("portfolio_positions").select("avg_price,lots,ticker,realized_pnl").eq("active", true)

// After
pool.query("SELECT avg_price, lots, ticker, realized_pnl FROM portfolio_positions WHERE active = true")
```

- [ ] **Step 2: Rewrite stocks/page.tsx**

~6 queries → `pool.query()`.

- [ ] **Step 3: Rewrite gold, funds, bonds, news, reviews pages**

Same pattern. Each page has 2-6 queries.

- [ ] **Step 4: Delete web/lib/supabase/ directory**

```bash
rm -rf web/lib/supabase/
```

- [ ] **Step 5: Verify all pages render**

```bash
cd web && npm run dev
```
Visit each page: `/`, `/stocks`, `/gold`, `/funds`, `/bonds`, `/news`, `/reviews`.

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "refactor: replace Supabase queries with pg in server components"
```

---

### Task 7: Replace Client Component Mutations with Server Actions

**Files:**
- Create: `web/app/stocks/actions.ts`
- Create: `web/app/gold/actions.ts`
- Create: `web/app/funds/actions.ts`
- Create: `web/app/bonds/actions.ts`
- Create: `web/app/news/actions.ts` (if needed)
- Modify: `web/components/PortfolioClient.tsx`
- Modify: `web/components/WatchlistClient.tsx`
- Modify: `web/components/GoldClient.tsx`
- Modify: `web/components/FundsClient.tsx`
- Modify: `web/components/BondsClient.tsx`
- Modify: `web/components/AccountChargesClient.tsx`
- Modify: `web/components/TickerDetail.tsx`

**Interfaces:**
- Consumes: `getPool()` from `web/lib/db.ts`
- Produces: Server actions that client components call instead of direct Supabase mutations

Key change: Client components currently import `createClient` from `@/lib/supabase/client` and run mutations directly in the browser via PostgREST. With pg, browser can't connect to Postgres. All mutations move to server actions.

Pattern per component:
1. Create `actions.ts` with `'use server'` functions for each mutation
2. Update client component to call server actions instead of `supabase.from(...).insert/update/delete`
3. After mutation, call `revalidatePath` to refresh server component data

Example for PortfolioClient:
```typescript
// web/app/stocks/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { getPool } from '@/lib/db'

export async function addTransaction(data: {
  ticker: string; side: string; lots: number; price: number; txn_at: string; notes: string
}) {
  await getPool().query(
    'INSERT INTO stock_transactions (ticker, side, lots, price, txn_at, notes) VALUES ($1,$2,$3,$4,$5,$6)',
    [data.ticker, data.side, data.lots, data.price, data.txn_at, data.notes]
  )
  revalidatePath('/stocks')
}
```

For **TickerDetail.tsx** (client-side reads): these reads also need server actions or should be converted to fetch from an API route, since they're dynamic per-ticker. Server action with `'use server'` returning data works.

- [ ] **Step 1: Create stocks/actions.ts**

Server actions for: `addTransaction`, `addDividend`, `requestPriceRefresh`, `deleteWatchlistTicker`.

- [ ] **Step 2: Update PortfolioClient.tsx + WatchlistClient.tsx**

Replace `supabase.from(...)` mutation calls with server action imports.

- [ ] **Step 3: Create gold/actions.ts + update GoldClient.tsx**

Server actions for: `addGoldPurchase`, `sellGold`, `requestGoldRefresh`.

- [ ] **Step 4: Create funds/actions.ts + update FundsClient.tsx**

Server actions for: `addFundPurchase`, `requestFundRefresh`.

- [ ] **Step 5: Create bonds/actions.ts + update BondsClient.tsx**

Server actions for: `addBondHolding`, `updateBondHolding`, `deactivateBondHolding`, `addCouponPayment`, `bulkAddCouponPayments`.

- [ ] **Step 6: Update AccountChargesClient.tsx**

Server actions for: `addCharge`, `deleteCharge`.

- [ ] **Step 7: Update TickerDetail.tsx**

Convert the parallel Supabase reads into a single server action that returns all ticker data:

```typescript
// web/app/stocks/actions.ts
export async function getTickerDetail(ticker: string) {
  const pool = getPool()
  const [snapshots, position, transactions, dividends, analyses, news, accuracy] =
    await Promise.all([
      pool.query('SELECT * FROM stock_snapshots WHERE ticker = $1 ORDER BY fetched_at DESC LIMIT 1000', [ticker]),
      pool.query('SELECT * FROM portfolio_positions WHERE ticker = $1 AND active = true LIMIT 1', [ticker]),
      // ... etc
    ])
  return { snapshots: snapshots.rows, position: position.rows[0] ?? null, /* ... */ }
}
```

- [ ] **Step 8: Remove all supabase client imports from web/components/**

Grep for remaining `@/lib/supabase/client` imports. Should be zero.

- [ ] **Step 9: Verify all CRUD flows**

Test in browser: add/edit/delete for stocks, gold, funds, bonds. Verify TickerDetail modal loads.

- [ ] **Step 10: Commit**

```bash
git add web/
git commit -m "refactor: replace client Supabase mutations with server actions"
```

---

### Task 8: Docker + CI Updates

**Files:**
- Modify: `docker/docker-compose.yml` (update env vars)
- Modify: `docker/Dockerfile.app` (no supabase-js dep, add pg)
- Modify: `docker/Dockerfile.web`
- Modify: `.github/workflows/build.yml` (update env for tests)
- Modify: `.env.example` (document new vars)

**Interfaces:**
- Consumes: nothing new
- Produces: working Docker + CI with pg instead of Supabase client

- [ ] **Step 1: Update env vars everywhere**

Remove: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Add: `DATABASE_URL`, `AUTH_SECRET` (NextAuth)

Keep: `NEXT_PUBLIC_*` pattern for any remaining runtime web vars (non-auth).

- [ ] **Step 2: Update docker-compose.yml**

Replace Supabase env vars with `DATABASE_URL` and `AUTH_SECRET`.

- [ ] **Step 3: Update CI workflow**

Set `DATABASE_URL` in test jobs. May need a Postgres service container for integration tests.

- [ ] **Step 4: Update window.__ENV injection**

Remove `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the runtime env injection in the root layout. These are no longer needed since all queries happen server-side.

- [ ] **Step 5: Verify Docker builds**

```bash
docker compose -f docker/docker-compose.yml build
```

- [ ] **Step 6: Commit**

```bash
git add docker/ .github/ .env.example
git commit -m "chore: update Docker/CI for pg migration"
```

---

## Phase 4: Vitalix (DEFERRED)

> Vitalix stays untouched for now. When Vitalix migrates from Express to Next.js, it will adopt `@marvello/common-tech` for DB access and NextAuth for auth. See memory: `vitalix-nextjs-migration`.

---

## Verification

### End-to-End Checklist

1. **Backend pipeline:** `cd app && npm run prices -- BBCA` → snapshot saved to pg
2. **Full analysis:** `cd app && npm run portfolio` → analysis runs, saves to pg, sends Telegram
3. **Bot:** `npm run bot` → `/status` command responds
4. **Web login:** visit `localhost:3000` → redirected to `/login` → enter creds via NextAuth → dashboard loads
5. **Web CRUD:** add a stock transaction, add gold purchase, add fund — all persist
6. **Web reads:** all pages load data (dashboard, stocks, gold, funds, bonds, news, reviews)
7. **TickerDetail:** click a ticker → modal shows snapshots, transactions, analyses
8. **Docker:** `docker compose build && docker compose up -d` → all services healthy
9. **CI:** push to branch → GitHub Actions pass (typecheck + vitest + web build)

### Migration Rollback Plan

- Keep Supabase instance running until pg migration is verified in production
- Old `.env` vars documented for rollback
- Git branch per phase allows reverting individual phases

---

## Risk Notes

- **PostgREST pagination gone:** `getSnapshotPricesSince` had PostgREST `max-rows` workaround — with direct pg, the full result set returns in one query. Simplifies the function.
- **RLS removal:** Auth enforcement moves from DB to app middleware. All routes already gated by proxy.ts. Server actions inherit the auth gate.
- **Client-side reads → server actions:** TickerDetail does heavy client-side Supabase reads. Moving to server actions adds a network hop but removes the browser→PostgREST dependency. Performance should be neutral (server is closer to DB).
- **window.__ENV shrinks:** No more `NEXT_PUBLIC_SUPABASE_*` vars needed in browser. The env injection can stay for other future runtime vars.
