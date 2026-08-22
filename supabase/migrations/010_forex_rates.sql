-- Forex exchange rates fetched from Finnhub.
-- Stored per (base, quote) pair; idempotent on (base_currency, quote_currency, rate_at).
create table if not exists public.forex_rates (
    id             bigserial primary key,
    base_currency  varchar(5)        not null,
    quote_currency varchar(5)        not null,
    rate           double precision  not null,
    rate_at        date              not null,  -- effective date (UTC)
    fetched_at     timestamptz       not null
);

create unique index if not exists ux_forex_rates_pair_date
    on public.forex_rates (base_currency, quote_currency, rate_at);

-- ── view: latest_forex_rates (one row per pair, most recent date) ──
create or replace view public.latest_forex_rates with (security_invoker = true) as
select distinct on (base_currency, quote_currency) *
from public.forex_rates
order by base_currency, quote_currency, rate_at desc, id desc;

-- RLS: anon denied, authenticated read-only, service role bypasses.
alter table public.forex_rates enable row level security;
drop policy if exists read_forex_rates on public.forex_rates;
create policy read_forex_rates on public.forex_rates
    for select to authenticated using (true);
