-- IDX-sourced upcoming dividend schedule per held stock (all 4 dates from the
-- IDX corporate-action API; amount backfilled from yahoo's trailing-annual rate
-- when IDX's is 0/absent, flagged via amount_estimated).
-- Forecast only (idx rows refreshed each sync); actuals live in stock_dividends.
-- source = idx | manual; manual rows are never overwritten by the sync.
create table if not exists public.dividend_schedule (
    id               bigserial primary key,
    ticker           varchar(10)      not null,
    cum_date         date,                          -- IDX TanggalCum
    ex_date          date             not null,     -- IDX TanggalExRegulerDanNegosiasi
    recording_date   date,                          -- IDX TanggalDPS
    pay_date         date,                          -- IDX TanggalPembayaran
    amount_per_share double precision,              -- IDX CashDividenPerSaham, else yahoo backfill; may be null
    amount_estimated boolean          not null default false,  -- true when amount came from yahoo annual proxy
    currency         varchar(5)                default 'IDR',  -- IDX CashDividenPerSahamMU
    source           varchar(10)      not null default 'idx',  -- idx | manual
    synced_at        timestamptz      not null default now(),
    unique (ticker, ex_date)
);
create index if not exists ix_dividend_schedule_ex  on public.dividend_schedule (ex_date);
create index if not exists ix_dividend_schedule_pay on public.dividend_schedule (pay_date);

alter table public.dividend_schedule enable row level security;
drop policy if exists rw_dividend_schedule on public.dividend_schedule;
create policy rw_dividend_schedule on public.dividend_schedule
    for all to authenticated using (true) with check (true);

insert into public.schema_migrations (version, name)
values ('022', '022_dividend_schedule') on conflict do nothing;
