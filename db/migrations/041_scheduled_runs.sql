-- 041: durable once-per-period latch for the graph runner's scheduled jobs.
-- The runner kept "last ran" dates in memory, so every restart re-sent dividend /
-- coupon reminders and re-ran the weekly review (new row + email). Each job now
-- claims (job, run_key) with INSERT ... ON CONFLICT DO NOTHING before running.
create table if not exists public.scheduled_runs (
    job        text        not null,
    run_key    text        not null,   -- e.g. WIB date '2026-10-06'
    claimed_at timestamptz not null default now(),
    primary key (job, run_key)
);

insert into public.schema_migrations (version, name)
values ('041', '041_scheduled_runs') on conflict do nothing;
