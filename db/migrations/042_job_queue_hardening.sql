-- 042: deep-run queue idempotency + restore indexes schema.sql dropped.
--
-- 1. persona_analyses: one vote per (run, persona). A worker crash after saving a
--    vote but before completing the job re-ran it and double-counted the vote.
--    Collapse existing duplicates (keep the first) before adding the constraint.
delete from public.persona_analyses p
 using public.persona_analyses q
 where p.run_id = q.run_id and p.persona = q.persona and p.id > q.id;
create unique index if not exists uq_persona_run_persona
    on public.persona_analyses (run_id, persona);

-- 2. Backoff for failed jobs: failJob sets retry_at; the claim skips jobs whose
--    retry_at is in the future, so a one-minute Ollama outage no longer burns
--    every attempt of every job in a run.
alter table public.analysis_jobs add column if not exists retry_at timestamptz;

create or replace function public.claim_analysis_job(max_attempts integer default 3)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
    j public.analysis_jobs;
begin
    select * into j
      from public.analysis_jobs a
     where a.status = 'pending'
       and a.attempts < max_attempts
       and (a.retry_at is null or a.retry_at <= now())
       and (a.kind = 'persona'
            or not exists (select 1
                             from public.analysis_jobs p
                            where p.run_id = a.run_id
                              and p.kind = 'persona'
                              and p.status in ('pending', 'running')))
     order by a.priority desc, a.id
     for update skip locked
     limit 1;

    if not found then
        return;
    end if;

    update public.analysis_jobs
       set status = 'running', attempts = attempts + 1, started_at = now()
     where id = j.id;

    return query select * from public.analysis_jobs where id = j.id;
end
$$;

-- 3. Indexes from 028 / 014 that db/schema.sql never carried: a database
--    bootstrapped from schema.sql had no double-enqueue guard. No-ops where present.
create unique index if not exists uq_active_consensus_per_ticker
    on public.analysis_jobs (ticker)
    where kind = 'consensus' and status in ('pending', 'running');
create index if not exists idx_refresh_requests_kind_pending
    on public.price_refresh_requests (kind) where processed_at is null;

insert into public.schema_migrations (version, name)
values ('042', '042_job_queue_hardening') on conflict do nothing;
