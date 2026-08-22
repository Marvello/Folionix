---
type: runbook
title: Supabase Foundation Runbook
description: How to bootstrap the self-hosted Supabase stack Folionix depends on — schema, migrations, keys, RLS.
---

# Supabase Foundation Runbook

Folionix's source of truth is a **self-hosted Supabase stack that is its own
separate deployment — not vendored into this repo**. Treat any local
`docker/supabase/` as throwaway infra and never commit it. This runbook covers
standing that stack up and loading Folionix's schema.

## Assets in this repo (`supabase/`)

- **`schema.sql`** — the full, idempotent schema: tables, views, RPC, and RLS.
  Apply this first on a fresh database.
- **`migrations/NNN_name.sql`** — incremental schema changes, applied **manually
  in numeric order** (psql or the Supabase SQL editor). There is no runner and
  no code path that applies them — never apply a migration from app code or
  tests.
- **`gen_keys.py`** — JWT `anon` / `service_role` key generator (CLI), keyed off
  the stack's JWT secret.
- **`seed.sql`** — optional static bootstrap snapshot (hand-edited).
- **`imports/`** — local one-time personal-data imports; gitignored, never
  committed.

## Bootstrap order

1. Stand up the self-hosted Supabase stack separately (Postgres + PostgREST +
   Auth + Studio). It is not part of this repo's `docker-compose.yml`.
2. Generate `anon` + `service_role` keys with `gen_keys.py` against the stack's
   JWT secret.
3. Apply `supabase/schema.sql` to the fresh database.
4. Apply any `supabase/migrations/*.sql` **in numeric order** that post-date the
   `schema.sql` snapshot.
5. (Optional) load `supabase/seed.sql` and/or `supabase/imports/*.sql`.

## Migration ledger

Applied migrations are tracked in `public.schema_migrations`
(`version`, `name`, `applied_at`). Every migration file **must end** with:

```sql
insert into public.schema_migrations (version, name)
values ('NNN', 'NNN_name') on conflict do nothing;
```

so `select version from public.schema_migrations order by version` reflects
what is live.

## RLS model

- `anon` — denied everything.
- `authenticated` — reads all; writes portfolio/watchlist (and the web-only
  domains: gold/funds/bonds/dividends).
- `service_role` (backend, `SUPABASE_SERVICE_KEY`) — bypasses RLS.

## Environment wiring

- Backend (`app/`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service role,
  bypasses RLS — backend-only, never shipped to the frontend).
- Web (`web/`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (anon key + RLS + Supabase Auth). Login is email + password
  (`signInWithPassword`); no public sign-up.
