-- 049: sector-aware peer valuation (tasks/todo.md "Feature: sector-aware peer valuation").

-- Peers live on the watchlist as kind 'peer' (full watchlist treatment); the weekly
-- peer refresh only ever adds/updates/removes rows of this kind.
alter table public.watchlist drop constraint if exists ck_watchlist_kind;
alter table public.watchlist
    add constraint ck_watchlist_kind check (kind in ('user', 'ai_suggested', 'peer'));

-- Official IDX-IC classification for every listing (IDX GetCompanyProfiles), refreshed weekly.
create table if not exists public.stock_classification (
    ticker        varchar(20) primary key,   -- yahoo symbol, e.g. BBCA.JK
    name          text,
    sector        text,
    sub_sector    text,
    industry      text,
    sub_industry  text,
    board         text,                      -- PapanPencatatan (Utama / Pengembangan / …)
    listed_at     date,
    updated_at    timestamptz not null default now()
);
create index if not exists ix_classification_sub_industry on public.stock_classification (sub_industry);
create index if not exists ix_classification_industry on public.stock_classification (industry);

-- Peer group per holding: same sub-industry (industry when < 3), top 8 by market cap.
create table if not exists public.stock_peers (
    ticker      varchar(20) not null,     -- the holding
    peer        varchar(20) not null,
    rank        integer     not null,     -- 1 = largest market cap in the group
    basis       text        not null,     -- 'sub_industry' | 'industry'
    group_name  text        not null,     -- e.g. 'Bank'
    updated_at  timestamptz not null default now(),
    primary key (ticker, peer)
);

-- Inputs for EV-based multiples, all in IDR (fx-converted for USD reporters).
alter table public.stock_key_stats
    add column if not exists market_cap    double precision,
    add column if not exists total_revenue double precision,
    add column if not exists ebitda        double precision,
    add column if not exists trailing_pe   double precision;

-- Own-history comparison: one row per fiscal year, multiples at the year-end price (IDR).
create table if not exists public.stock_annual_multiples (
    ticker      varchar(20) not null,
    period_end  date        not null,
    price       double precision,
    net_income  double precision,
    equity      double precision,
    revenue     double precision,
    ebitda      double precision,
    net_debt    double precision,
    shares      double precision,
    pe          double precision,
    pb          double precision,
    ps          double precision,
    ev_ebitda   double precision,
    fetched_at  timestamptz not null default now(),
    primary key (ticker, period_end)
);

-- Latest computed 3-way comparison per ticker (written daily after the fundamentals
-- sweep, read by the dashboard and the prompts). `result` is the structured form.
create table if not exists public.stock_valuation (
    ticker       varchar(20) primary key,
    computed_at  timestamptz not null default now(),
    lens         text        not null,
    summary      text        not null,
    result       jsonb       not null
);

insert into public.schema_migrations (version, name)
values ('049', '049_peer_valuation') on conflict do nothing;
