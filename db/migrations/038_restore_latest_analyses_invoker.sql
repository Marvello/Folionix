-- Repair drift caused by an over-eager first run of the startup migration
-- runner. A database bootstrapped from the older db/schema.sql has a
-- schema_migrations ledger containing only '034' and '036', so the runner read
-- 001-033 and 035 as pending and began replaying them. It applied 001 and 002
-- (both idempotent) before aborting on 003 with `role "authenticated" does not
-- exist`, which rolled back cleanly.
--
-- 002 is the one that left a mark: it recreates latest_analyses without the
-- `with (security_invoker = true)` that schema.sql and migration 006 set, and
-- `create or replace view` resets the option to its default. Harmless today —
-- migration 035 dropped RLS, so no policy depends on it — but it is drift from
-- schema.sql, and silent drift is how the next surprise gets built.
--
-- The runner now refuses to execute anything at or below SCHEMA_BASELINE
-- ('036'), recording ledger rows for those instead of running them, so this
-- cannot recur. See app/src/db/migrate.ts.
create or replace view public.latest_analyses with (security_invoker = true) as
select distinct on (ticker) *
from public.llm_analyses
order by ticker, analysed_at desc, id desc;

insert into public.schema_migrations (version, name)
values ('038', '038_restore_latest_analyses_invoker') on conflict do nothing;
