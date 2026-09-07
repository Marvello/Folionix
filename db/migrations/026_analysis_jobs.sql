-- Multi-agent deep-analysis job queue + persona results.
-- analysis_jobs: one deep run (run_id) = N persona jobs + 1 consensus job.
-- Claimed by the folionix-worker via claim_analysis_job() — an atomic
-- FOR UPDATE SKIP LOCKED claim safe for concurrent workers (unlike the
-- SELECT-then-UPDATE pattern used by price_refresh_requests).
-- persona_analyses: structured persona verdicts; the consensus result lands
-- in llm_analyses through the normal saveAnalysis path so accuracy scoring,
-- weekly reviews, and the web UI keep working unchanged.
create table if not exists public.analysis_jobs (
    id           bigserial primary key,
    ticker       varchar(15)  not null,
    kind         varchar(10)  not null check (kind in ('persona', 'consensus')),
    persona      varchar(30),
    run_id       uuid         not null,
    status       varchar(10)  not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'error')),
    priority     integer      not null default 0,
    payload      jsonb,
    result       jsonb,
    attempts     integer      not null default 0,
    error        text,
    created_at   timestamptz  not null default now(),
    started_at   timestamptz,
    finished_at  timestamptz
);
create index if not exists ix_jobs_claim on public.analysis_jobs (status, priority desc, id)
    where status = 'pending';
create index if not exists ix_jobs_run on public.analysis_jobs (run_id);
create index if not exists ix_jobs_ticker_active on public.analysis_jobs (ticker)
    where status in ('pending', 'running');

alter table public.analysis_jobs enable row level security;
drop policy if exists read_analysis_jobs on public.analysis_jobs;
create policy read_analysis_jobs on public.analysis_jobs
    for select to authenticated using (true);

create table if not exists public.persona_analyses (
    id           bigserial primary key,
    run_id       uuid         not null,
    snapshot_id  bigint       references public.stock_snapshots(id),
    ticker       varchar(15)  not null,
    persona      varchar(30)  not null,
    signal       varchar(10)  not null check (signal in ('bullish', 'neutral', 'bearish')),
    confidence   integer      not null check (confidence between 0 and 100),
    reasoning    text,
    model        varchar(50),
    analysed_at  timestamptz  not null default now()
);
create index if not exists ix_persona_run on public.persona_analyses (run_id);
create index if not exists ix_persona_ticker on public.persona_analyses (ticker, analysed_at desc);

alter table public.persona_analyses enable row level security;
drop policy if exists read_persona_analyses on public.persona_analyses;
create policy read_persona_analyses on public.persona_analyses
    for select to authenticated using (true);

-- Atomic claim: one job per call, oldest-highest-priority first. A consensus
-- job is claimable only once every persona job in its run is terminal (done
-- or error), so the aggregate always sees the full persona set.
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

insert into public.schema_migrations (version, name)
values ('026', '026_analysis_jobs') on conflict do nothing;
