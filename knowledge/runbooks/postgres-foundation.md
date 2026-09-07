---
type: runbook
title: Postgres Foundation Runbook
description: How to bootstrap the self-hosted Postgres database Folionix depends on — schema, migrations, auth, roles.
---

# Postgres Foundation Runbook

Folionix's source of truth is a **plain self-hosted Postgres database**, run as
the `folionix-db` service in `docker/docker-compose.yml` (`postgres:17-alpine`,
persisted to the `pgdata` volume). Both `app/` and `web/` open their own
`node-postgres` pool against `DATABASE_URL` and speak raw SQL — there is no
PostgREST, no backend API between the web app and the database.

> **History.** Folionix ran on self-hosted Supabase until migrations `035`
> (drop RLS) and `036` (NextAuth tables) moved it to plain Postgres +
> NextAuth. The SQL directory was named `supabase/` until that history was
> cleaned up. Anything referring to `anon` / `authenticated` / `service_role`,
> PostgREST, or `SUPABASE_*` env vars predates the switch — those roles and
> the `auth` schema do not exist here, and a migration that touches them
> unguarded will abort.

## Assets in this repo (`db/`)

- **`schema.sql`** — the full, idempotent schema: tables, views, RPC. Apply
  this first on a fresh database. It **is** the consolidated result of
  migrations `001`–`036` and registers all of them in `schema_migrations`.
- **`migrations/NNN_name.sql`** — incremental schema changes, applied **manually
  in numeric order** (`psql`). There is no runner and no code path that applies
  them — never apply a migration from app code or tests.

> **Never replay `001`–`036` on a fresh database.** Migrations `003`–`033`
> predate `035_drop_rls` and still carry Supabase-only constructs — `create
> policy ... to authenticated`, `auth.role()`, `revoke ... from anon`. On plain
> Postgres those abort with `role "authenticated" does not exist` or `schema
> "auth" does not exist`. They are kept as history, not as a replayable path;
> `schema.sql` already contains their result. Apply `037`+ only.
- **`seed.sql`** — optional static bootstrap snapshot (hand-edited).
- **`imports/`** — one-time personal-data imports (e.g. Stockbit history),
  gitignored.

## Bootstrap order

1. Start the database: `docker compose -f docker/docker-compose.yml up -d folionix-db`.
2. Set `DATABASE_URL` in `.env` (e.g. `postgresql://folionix:...@localhost:5432/folionix`).
   Both `app/` and `web/` read the same variable.
3. Apply the schema: `psql "$DATABASE_URL" -f db/schema.sql`.
4. Apply `db/migrations/*.sql` from `037` onward, **in numeric order**.
   Everything up to `036` is already in `schema.sql`.
5. (Optional) load `db/seed.sql` and/or `db/imports/*.sql`.
6. Set `AUTH_SECRET` (`openssl rand -base64 32`) and insert a row into
   `public.users` with a bcrypt `password_hash` — there is no public sign-up.

## Applying a migration

```bash
psql "$DATABASE_URL" -f db/migrations/NNN_name.sql
```

Wrap anything you are unsure about in an explicit transaction so a parse error
rolls back cleanly:

```bash
psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f db/migrations/NNN_name.sql
```

## Migration ledger

Applied migrations are tracked in `public.schema_migrations`
(`version`, `name`, `applied_at`). Every migration file **must end** with:

```sql
insert into public.schema_migrations (version, name)
values ('NNN', 'NNN_name') on conflict do nothing;
```

so `select version from public.schema_migrations order by version` reflects
what is live.

## Access model

There is **no RLS** — migration `035_drop_rls` dropped every policy and
disabled it on every table. Both processes connect as the database owner, so
any database access is full access.

- Authorization lives in the web tier: NextAuth Credentials (bcrypt against
  `public.users`, JWT sessions) in `web/lib/auth.ts`, gated by `web/proxy.ts`.
- `SECURITY DEFINER` functions grant `EXECUTE` to `public`, the plain-Postgres
  default that migration `035` settled on. Do not reintroduce grants to
  `anon` / `authenticated` / `service_role`: those roles do not exist, and an
  unguarded `revoke ... from anon` fails with `role "anon" does not exist`.
- Keep `DATABASE_URL` server-side only. It must never reach a `NEXT_PUBLIC_*`
  variable or the browser bundle.

## Environment wiring

- Both `app/` and `web/`: `DATABASE_URL`.
- Web only: `AUTH_SECRET`, `AUTH_URL` (NextAuth).
- Local `/aireview`: `FOLIONIX_WEB_URL`, `AIREVIEW_API_TOKEN` — the database is
  not reachable from a dev machine, so the command curls the deployed web app's
  `/api/weekly-reviews/latest` instead.
