-- supabase/migrations/016_stock_dividends.sql
-- Dividend income received per stock. Income (not capital): feeds the
-- Capital-vs-Income split. amount is total net IDR received.
create table if not exists public.stock_dividends (
    id         bigserial primary key,
    ticker     varchar(10)      not null,
    amount     double precision not null,        -- total IDR received (net)
    per_share  double precision,                 -- optional IDR/share
    paid_at    date             not null,
    notes      text             default '',
    created_at timestamptz      not null default now()
);
create index if not exists ix_stock_div_ticker
    on public.stock_dividends (ticker, paid_at desc);

alter table public.stock_dividends enable row level security;
drop policy if exists rw_stock_dividends on public.stock_dividends;
create policy rw_stock_dividends on public.stock_dividends
    for all to authenticated using (true) with check (true);
