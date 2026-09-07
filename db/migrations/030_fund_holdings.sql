-- 030_fund_holdings
--
-- Portfolio composition per fund, from Cermati's per-fund detail endpoint
-- (/api/v2/mutual-funds/products/s/{slug} → fundPortfolioCompositions[0]).
-- Refreshed only for funds actually held (bounded fan-out), replace-on-write
-- per fund keyed by as_of (portfolioAt).

create table if not exists public.fund_holdings (
    fund_code  varchar(40) not null,
    label      text        not null,   -- composition name (e.g. "ALIBABA GROUP HOLDING LTD")
    ticker     varchar(20),            -- composition code when present
    percentage double precision,       -- allocationPercentage
    as_of      date        not null,   -- portfolioAt
    primary key (fund_code, label, as_of)
);
create index if not exists ix_fund_holdings_code on public.fund_holdings (fund_code);

alter table public.fund_holdings enable row level security;

drop policy if exists read_fund_holdings on public.fund_holdings;
create policy read_fund_holdings on public.fund_holdings
    for select to authenticated using (true);

insert into public.schema_migrations (version, name)
values ('030', '030_fund_holdings') on conflict do nothing;
