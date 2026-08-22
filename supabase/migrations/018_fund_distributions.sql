-- supabase/migrations/018_fund_distributions.sql
-- Cash distributions received from distributing mutual funds. Income (not
-- capital): feeds the Capital-vs-Income split.
create table if not exists public.fund_distributions (
    id         bigserial primary key,
    fund_code  varchar(40)      not null,
    amount     double precision not null,      -- total IDR received
    paid_at    date             not null,
    notes      text             default '',
    created_at timestamptz      not null default now()
);
create index if not exists ix_fund_dist_code
    on public.fund_distributions (fund_code, paid_at desc);

alter table public.fund_distributions enable row level security;
drop policy if exists rw_fund_distributions on public.fund_distributions;
create policy rw_fund_distributions on public.fund_distributions
    for all to authenticated using (true) with check (true);
