-- 005_funds_bonds.sql — mutual funds (NAV-valued) + bonds (par-valued)

-- ── FUNDS ─────────────────────────────────────────────
-- catalog: the fund universe for web autocomplete; upserted by the refresh sweep
create table if not exists public.fund_catalog (
    code               varchar(40) primary key,   -- cermati fund code
    name               text not null,
    fund_type          varchar(30),               -- SAHAM / PASAR_UANG / ...
    category           varchar(20),               -- KONVENSIONAL / SYARIAH
    investment_manager text,
    currency           varchar(5) default 'IDR',
    active             boolean default true,
    updated_at         timestamptz not null
);

-- NAV history per fund
create table if not exists public.fund_snapshots (
    id         bigserial primary key,
    fund_code  varchar(40) not null,
    nav        double precision,          -- NAV per unit (currentNav)
    currency   varchar(5) default 'IDR',
    nav_at     date,                      -- provider lastUpdatedNav (date)
    fetched_at timestamptz not null
);
create index if not exists ix_fund_snapshots_code_fetched
    on public.fund_snapshots (fund_code, fetched_at desc);
-- idempotency: one snapshot per fund per NAV date
create unique index if not exists ux_fund_snapshots_code_navat
    on public.fund_snapshots (fund_code, nav_at);

create or replace view public.latest_fund_navs as
select distinct on (fund_code) *
from public.fund_snapshots
order by fund_code, id desc;

-- holdings
create table if not exists public.fund_purchases (
    id                bigserial primary key,
    fund_code         varchar(40) not null,
    fund_name         text default '',
    platform          varchar(30) default '',  -- where bought (Bibit, Bareksa, ...)
    units             double precision not null,
    buy_nav_per_unit  double precision not null,
    purchased_at      timestamptz not null,
    active            boolean default true,
    notes             text default '',
    updated_at        timestamptz not null
);

-- ── BONDS ─────────────────────────────────────────────
create table if not exists public.bond_holdings (
    id            bigserial primary key,
    series_type   varchar(8) not null
                  check (series_type in ('SR','ORI','SBR','ST','CORP')),
    series_code   varchar(30) not null,   -- e.g. ORI025, SR021, corp name/ISIN
    platform      varchar(30) default '', -- where bought (Bibit, Bareksa, BCA, ...)
    principal     double precision not null,  -- IDR nominal held
    coupon_rate   double precision,           -- annual %, nullable
    maturity_date date,
    purchased_at  timestamptz not null,
    active        boolean default true,
    notes         text default '',
    updated_at    timestamptz not null
);

-- ── RLS ───────────────────────────────────────────────
-- catalog + snapshots: authenticated read; writes via service role (refresh job)
-- purchases + holdings: authenticated read+write; service role bypasses
alter table public.fund_catalog   enable row level security;
alter table public.fund_snapshots enable row level security;
alter table public.fund_purchases enable row level security;
alter table public.bond_holdings  enable row level security;

drop policy if exists read_fund_catalog on public.fund_catalog;
create policy read_fund_catalog on public.fund_catalog
    for select to authenticated using (true);

drop policy if exists read_fund_snapshots on public.fund_snapshots;
create policy read_fund_snapshots on public.fund_snapshots
    for select to authenticated using (true);

drop policy if exists rw_fund_purchases on public.fund_purchases;
create policy rw_fund_purchases on public.fund_purchases
    for all to authenticated using (true) with check (true);

drop policy if exists rw_bond_holdings on public.bond_holdings;
create policy rw_bond_holdings on public.bond_holdings
    for all to authenticated using (true) with check (true);
