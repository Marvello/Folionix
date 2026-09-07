-- 028_one_active_run_per_ticker
--
-- enqueueDeepRun() checks hasActiveRun() then inserts jobs — a TOCTOU window
-- where two concurrent enqueues for the same ticker both pass the check and
-- double-enqueue a run. Each run has exactly one 'consensus' job, so a partial
-- unique index on the ticker over active consensus jobs enforces "at most one
-- active run per ticker" at the DB level; the losing insert aborts atomically
-- (all job rows go in one insert), and the caller treats the violation as
-- "active run exists".
create unique index if not exists uq_active_consensus_per_ticker
    on public.analysis_jobs (ticker)
    where kind = 'consensus' and status in ('pending', 'running');

insert into public.schema_migrations (version, name)
values ('028', '028_one_active_run_per_ticker') on conflict do nothing;
