-- IDX Portfolio — Postgres schema (idempotent)
-- Apply via: psql "$DATABASE_URL" -f supabase/schema.sql

-- ── schema_migrations (must exist before any insert references it) ──
create table if not exists public.schema_migrations (
    version    varchar          primary key,
    name       text             not null,
    applied_at timestamptz      not null default now()
);

-- ── stock_snapshots ──
create table if not exists public.stock_snapshots (
    id                  bigserial primary key,
    fetched_at          timestamptz not null,
    ticker              varchar(10) not null,
    symbol              varchar(15),
    name                varchar(100),
    sector              varchar(80),
    industry            varchar(80),
    current_price       double precision,
    prev_close          double precision,
    day_change          double precision,
    day_change_pct      double precision,
    high_52w            double precision,
    low_52w             double precision,
    volume              bigint,
    avg_price           double precision,
    lots                integer,
    unrealized_pnl      double precision,
    unrealized_pnl_pct  double precision,
    total_pnl           double precision,
    position_status     varchar(30),
    dist_from_high      double precision,
    dist_from_low       double precision,
    pe                  double precision,
    pb                  double precision,
    roe_pct             double precision,
    div_yield_pct       double precision,
    profit_margin_pct   double precision,
    debt_to_equity      double precision,
    beta                double precision,
    eps                 double precision,
    market_cap_raw      double precision,
    revenue_raw         double precision
);
create index if not exists ix_snapshots_ticker      on public.stock_snapshots (ticker);
create index if not exists ix_snapshots_fetched_at  on public.stock_snapshots (fetched_at);

-- ── llm_analyses ──
create table if not exists public.llm_analyses (
    id              bigserial primary key,
    snapshot_id     bigint not null references public.stock_snapshots(id),
    analysed_at     timestamptz not null,
    ticker          varchar(10) not null,
    model           varchar(50),
    recommendation  varchar(30),
    raw_output      text,
    clean_html      text,
    sent_telegram   boolean default false,
    skipped_same    boolean default false
);
create index if not exists ix_analyses_ticker       on public.llm_analyses (ticker);
create index if not exists ix_analyses_analysed_at  on public.llm_analyses (analysed_at);

-- ── news_cache ──
create table if not exists public.news_cache (
    id            bigserial primary key,
    fetched_at    timestamptz not null,
    ticker        varchar(10),
    source        varchar(50) not null,
    headline      varchar(500) not null,
    summary       text,
    url           varchar(500) not null,
    published_at  timestamptz,
    language      varchar(5) default 'id',
    constraint uq_news_url unique (url)
);
create index if not exists ix_news_fetched_at  on public.news_cache (fetched_at);
create index if not exists ix_news_ticker      on public.news_cache (ticker);

-- ── news_sentiments ──
create table if not exists public.news_sentiments (
    id             bigserial primary key,
    ticker         varchar(10) not null,
    summarized_at  timestamptz not null,
    depth          varchar(10) not null,
    score          integer not null,
    themes         text,
    catalyst       text,
    risk           text,
    raw_output     text
);
create index if not exists ix_sentiments_ticker        on public.news_sentiments (ticker);
create index if not exists ix_sentiments_summarized_at on public.news_sentiments (summarized_at);

-- ── portfolio_positions (source of truth) ──
create table if not exists public.portfolio_positions (
    id          bigserial primary key,
    ticker      varchar(10) not null,
    avg_price   double precision not null,
    lots        integer default 0,
    active      boolean default true,
    notes       text default '',
    updated_at  timestamptz not null,
    realized_pnl double precision not null default 0,
    constraint uq_portfolio_ticker unique (ticker)
);

-- ── stock_transactions ──
create table if not exists public.stock_transactions (
    id         bigserial primary key,
    ticker     varchar(10)      not null,
    side       varchar(4)       not null check (side in ('BUY','SELL')),
    lots       integer          not null check (lots > 0),   -- 1 lot = 100 shares
    price      double precision not null,                    -- executed IDR/share
    fee        double precision not null default 0,          -- broker fee IDR
    txn_at     timestamptz      not null,
    notes      text             default '',
    created_at timestamptz      not null default now()
);
create index if not exists ix_stock_txn_ticker
    on public.stock_transactions (ticker, txn_at);

-- ── stock_dividends ──
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

-- ── recompute function: folds stock_transactions into portfolio_positions cache ──
-- Weighted average: SELL keeps avg, reduces lots, realizes (price-avg)*lots*100.
create or replace function public.recompute_stock_position(p_ticker varchar)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r          record;
    v_lots     integer := 0;
    v_avg      double precision := 0;
    v_realized double precision := 0;
    v_new_lots integer;
    v_sell     integer;
    v_notes    text;
begin
    -- avg_price is per share; fees are folded into cost basis. A BUY adds its
    -- fee to the cost of the shares acquired; a SELL's fee reduces realized P&L.
    for r in
        select side, lots, price, fee
        from public.stock_transactions
        where ticker = p_ticker
        order by txn_at asc, id asc
    loop
        if r.side = 'BUY' then
            v_new_lots := v_lots + r.lots;
            v_avg := (v_avg * v_lots * 100 + r.price * r.lots * 100 + r.fee)
                     / (v_new_lots * 100);
            v_lots := v_new_lots;
        else
            v_sell := least(r.lots, v_lots);
            v_realized := v_realized + (r.price - v_avg) * v_sell * 100 - r.fee;
            v_lots := v_lots - v_sell;
            if v_lots = 0 then v_avg := 0; end if;
        end if;
    end loop;

    -- preserve any existing notes on the position row
    select notes into v_notes from public.portfolio_positions where ticker = p_ticker;

    insert into public.portfolio_positions
        (ticker, avg_price, lots, realized_pnl, active, notes, updated_at)
    values
        (p_ticker, v_avg, v_lots, v_realized, v_lots > 0, coalesce(v_notes, ''), now())
    on conflict (ticker) do update set
        avg_price    = excluded.avg_price,
        lots         = excluded.lots,
        realized_pnl = excluded.realized_pnl,
        active       = excluded.active,
        updated_at   = excluded.updated_at;
end;
$$;

-- ── trigger: recompute portfolio_positions cache on stock_transactions writes ──
create or replace function public.trg_stock_txn_recompute_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (tg_op = 'DELETE') then
        perform public.recompute_stock_position(old.ticker);
        return null;
    end if;
    if (tg_op = 'UPDATE' and old.ticker is distinct from new.ticker) then
        perform public.recompute_stock_position(old.ticker);
    end if;
    perform public.recompute_stock_position(new.ticker);
    return null;
end;
$$;

drop trigger if exists trg_stock_txn_recompute on public.stock_transactions;
create trigger trg_stock_txn_recompute
    after insert or update or delete on public.stock_transactions
    for each row execute function public.trg_stock_txn_recompute_fn();

-- ── watchlist (NEW — replaces watchlist.json) ──
create table if not exists public.watchlist (
    id        bigserial primary key,
    ticker    varchar(10) not null,
    kind      varchar(15) not null default 'user',  -- 'user' | 'ai_suggested'
    notes     text default '',
    sector    text default '',
    rationale text default '',
    added_at  timestamptz not null default now(),
    constraint uq_watchlist_ticker unique (ticker),
    constraint ck_watchlist_kind check (kind in ('user','ai_suggested'))
);

-- ── gold_purchases (gold holdings per purchase) ──
create table if not exists public.gold_purchases (
    id                 bigserial primary key,
    venue              varchar(30) not null,        -- matches a code-side provider key
    grams              double precision not null,   -- weight in grams
    buy_price_per_gram double precision not null,   -- IDR/g actually paid
    purchased_at       timestamptz not null,
    active             boolean default true,
    notes              text default '',
    updated_at         timestamptz not null,
    side               varchar(4) not null default 'BUY'
                       check (side in ('BUY','SELL'))
);

-- ── gold_snapshots (per-venue price history) ──
create table if not exists public.gold_snapshots (
    id         bigserial primary key,
    venue      varchar(30) not null,
    buy_price  double precision,   -- venue "you buy at" price/g (higher)
    sell_price double precision,   -- venue "you sell back at" price/g (lower)
    mid_price  double precision,
    price_at   timestamptz,        -- provider's own timestamp
    fetched_at timestamptz not null
);

create index if not exists ix_gold_snapshots_venue_fetched
    on public.gold_snapshots (venue, fetched_at desc);

-- ── fund_catalog (fund universe for web autocomplete; upserted by refresh sweep) ──
create table if not exists public.fund_catalog (
    code               varchar(40) primary key,   -- cermati fund code
    name               text not null,
    slug               text,                      -- cermati url slug (detail endpoint)
    fund_type          varchar(30),               -- SAHAM / PASAR_UANG / ...
    category           varchar(20),               -- KONVENSIONAL / SYARIAH
    investment_manager text,
    currency           varchar(5) default 'IDR',
    active             boolean default true,
    updated_at         timestamptz not null
);

-- ── fund_snapshots (NAV history per fund) ──
create table if not exists public.fund_snapshots (
    id            bigserial primary key,
    fund_code     varchar(40) not null,
    nav           double precision,          -- NAV per unit (currentNav)
    currency      varchar(5) default 'IDR',
    nav_at        date,                       -- provider lastUpdatedNav (date)
    aum           double precision,           -- currentAum
    expense_ratio double precision,           -- percent, e.g. 2.41
    cagr          double precision,           -- percent, best-horizon CAGR
    ret_1m        double precision,           -- oneMonthNav (percent)
    ret_3m        double precision,           -- threeMonthNav
    ret_ytd       double precision,           -- yearToDateNav
    ret_1y        double precision,           -- oneYearNav
    fetched_at    timestamptz not null
);
create index if not exists ix_fund_snapshots_code_fetched
    on public.fund_snapshots (fund_code, fetched_at desc);
-- idempotency: one snapshot per fund per NAV date
create unique index if not exists ux_fund_snapshots_code_navat
    on public.fund_snapshots (fund_code, nav_at);

-- ── fund_holdings (portfolio composition per held fund; from detail endpoint) ──
create table if not exists public.fund_holdings (
    fund_code  varchar(40) not null,
    label      text        not null,
    ticker     varchar(20),
    percentage double precision,
    as_of      date        not null,
    primary key (fund_code, label, as_of)
);
create index if not exists ix_fund_holdings_code on public.fund_holdings (fund_code);

-- ── fund_purchases (fund holdings per purchase) ──
create table if not exists public.fund_purchases (
    id                bigserial primary key,
    fund_code         varchar(40) not null,
    fund_name         text default '',
    platform          varchar(30) default '',  -- where bought (Bibit, Bareksa, ...)
    units             double precision not null,
    buy_nav_per_unit  double precision not null,
    purchased_at      timestamptz not null,
    active            boolean default true,
    currency          varchar(5) not null default 'IDR',
    notes             text default '',
    updated_at        timestamptz not null,
    side              varchar(4) not null default 'BUY'
                      check (side in ('BUY','SELL'))
);

-- ── bond_holdings (government/corporate bond holdings) ──
create table if not exists public.bond_holdings (
    id            bigserial primary key,
    series_type   varchar(8) not null
                  check (series_type in ('SR','ORI','SBR','ST','CORP')),
    series_code   varchar(30) not null,   -- e.g. ORI025, SR021, corp name/ISIN
    platform      varchar(30) default '', -- where bought (Bibit, Bareksa, BCA, ...)
    principal     double precision not null,  -- IDR nominal held
    purchase_price double precision,           -- IDR total paid (nullable; may differ from par)
    coupon_rate   double precision,           -- annual %, nullable
    maturity_date date,
    purchased_at  timestamptz not null,
    active        boolean default true,
    notes         text default '',
    updated_at    timestamptz not null
);

-- ── bond_coupon_payments (coupon receipts log per bond) ──
create table if not exists public.bond_coupon_payments (
    id              bigserial primary key,
    bond_holding_id bigint           not null references public.bond_holdings(id),
    amount          double precision not null,
    paid_at         date             not null,
    notes           text             default '',
    created_at      timestamptz      not null
);
create index if not exists ix_bond_coupon_payments_holding
    on public.bond_coupon_payments (bond_holding_id, paid_at desc);

-- ── bond_coupon_schedule (KSEI-sourced payment schedule per bond) ──
create table if not exists public.bond_coupon_schedule (
    id              bigserial primary key,
    bond_holding_id bigint not null references public.bond_holdings(id) on delete cascade,
    series_code     varchar(30) not null,
    distribution_date date not null,
    status          varchar(50),
    scraped_at      timestamptz default now(),
    unique (bond_holding_id, distribution_date)
);
create index if not exists idx_bcs_date on public.bond_coupon_schedule (distribution_date);

-- ── fund_distributions (income from distributing funds) ──
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

-- ── account_charges (account-level costs not tied to a holding) ──
create table if not exists public.account_charges (
    id         bigserial primary key,
    charged_at date             not null,
    type       varchar(20)      not null
               check (type in ('DATA_FEE','METERAI','LATE_FEE','OTHER')),
    amount     double precision not null,       -- IDR charged
    notes      text             default '',
    created_at timestamptz      not null default now()
);
create index if not exists ix_account_charges_date
    on public.account_charges (charged_at desc);

-- ── forex_rates (exchange rates from Finnhub) ──
create table if not exists public.forex_rates (
    id             bigserial primary key,
    base_currency  varchar(5)        not null,
    quote_currency varchar(5)        not null,
    rate           double precision  not null,
    rate_at        date              not null,
    fetched_at     timestamptz       not null
);
create unique index if not exists ux_forex_rates_pair_date
    on public.forex_rates (base_currency, quote_currency, rate_at);

-- ── dividend_schedule (IDX-sourced upcoming dividend dates) ──
create table if not exists public.dividend_schedule (
    id               bigserial primary key,
    ticker           varchar(10)      not null,
    cum_date         date,
    ex_date          date             not null,
    recording_date   date,
    pay_date         date,
    amount_per_share double precision,
    amount_estimated boolean          not null default false,
    currency         varchar(5)                default 'IDR',
    source           varchar(10)      not null default 'idx',
    synced_at        timestamptz      not null default now(),
    unique (ticker, ex_date)
);
create index if not exists ix_dividend_schedule_ex  on public.dividend_schedule (ex_date);
create index if not exists ix_dividend_schedule_pay on public.dividend_schedule (pay_date);

-- ── weekly_reviews (portfolio WoW + AI self-review reports) ──
create table if not exists public.weekly_reviews (
    id           bigserial primary key,
    week_start   date         not null,
    week_end     date         not null,
    report_md    text         not null,
    handover_md  text         not null default '',
    stats        jsonb,
    model        varchar(100),
    emailed      boolean      not null default false,
    created_at   timestamptz  not null default now()
);
create index if not exists ix_weekly_reviews_week on public.weekly_reviews (week_end desc);

-- ── view: latest_snapshots (one most-recent row per ticker) ──
create or replace view public.latest_snapshots with (security_invoker = true) as
select distinct on (ticker) *
from public.stock_snapshots
order by ticker, id desc;

-- ── view: latest_analyses (most recent analysis per ticker) ──
create or replace view public.latest_analyses with (security_invoker = true) as
select distinct on (ticker) *
from public.llm_analyses
order by ticker, analysed_at desc, id desc;

-- ── view: latest_forex_rates (one most-recent row per currency pair) ──
create or replace view public.latest_forex_rates with (security_invoker = true) as
select distinct on (base_currency, quote_currency) *
from public.forex_rates
order by base_currency, quote_currency, rate_at desc, id desc;

-- ── view: latest_gold_prices (one most-recent row per venue) ──
create or replace view public.latest_gold_prices with (security_invoker = true) as
select distinct on (venue) *
from public.gold_snapshots
order by venue, id desc;

-- ── view: latest_fund_navs (one most-recent row per fund, by NAV date) ──
create or replace view public.latest_fund_navs with (security_invoker = true) as
select distinct on (fund_code) *
from public.fund_snapshots
order by fund_code, nav_at desc nulls last, id desc;

-- ── fund_product_summary: net units + realized P&L (weighted average) ──
-- Drop first: the column set/order changed from migration 013's version, and
-- `create or replace view` cannot drop/reorder existing columns (ERROR 42P16).
drop view if exists public.fund_product_summary;
create view public.fund_product_summary with (security_invoker = true) as
with buys as (
    select fund_code,
           sum(units)                      as buy_units,
           sum(units * buy_nav_per_unit)   as buy_cost
    from public.fund_purchases
    where active = true and side = 'BUY'
    group by fund_code
),
sells as (
    select fund_code,
           sum(units)                      as sell_units,
           sum(units * buy_nav_per_unit)   as sell_proceeds
    from public.fund_purchases
    where active = true and side = 'SELL'
    group by fund_code
)
select
    b.fund_code,
    max(fc.name)                                                     as fund_name,
    max(fc.fund_type)                                                as fund_type,
    max(fc.investment_manager)                                       as investment_manager,
    max(fc.currency)                                                 as currency,
    (b.buy_units - coalesce(s.sell_units, 0))                        as total_units,
    b.buy_cost / nullif(b.buy_units, 0)                              as avg_buy_nav,
    (b.buy_units - coalesce(s.sell_units, 0)) * (b.buy_cost / nullif(b.buy_units, 0))
                                                                     as total_cost,
    fn.nav                                                           as latest_nav,
    fn.nav_at                                                        as nav_at,
    (b.buy_units - coalesce(s.sell_units, 0)) * fn.nav              as current_value,
    (b.buy_units - coalesce(s.sell_units, 0)) * fn.nav
        - (b.buy_units - coalesce(s.sell_units, 0)) * (b.buy_cost / nullif(b.buy_units, 0))
                                                                     as pnl,
    -- realized: proceeds − (avg buy nav × units sold)
    coalesce(s.sell_proceeds, 0)
        - coalesce(s.sell_units, 0) * (b.buy_cost / nullif(b.buy_units, 0))
                                                                     as realized_pnl,
    (
        ((b.buy_units - coalesce(s.sell_units, 0)) * fn.nav
         - (b.buy_units - coalesce(s.sell_units, 0)) * (b.buy_cost / nullif(b.buy_units, 0)))
        / nullif((b.buy_units - coalesce(s.sell_units, 0)) * (b.buy_cost / nullif(b.buy_units, 0)), 0)
        * 100
    )                                                              as pnl_pct
from buys b
left join sells s on s.fund_code = b.fund_code
left join public.latest_fund_navs fn on fn.fund_code = b.fund_code
left join public.fund_catalog fc on fc.code = b.fund_code
group by b.fund_code, b.buy_units, b.buy_cost, s.sell_units, s.sell_proceeds, fn.nav, fn.nav_at;

-- ── view: news_with_latest_sentiment ──
-- Each news row carries the latest sentiment for its ticker (null if none).
create or replace view public.news_with_latest_sentiment with (security_invoker = true) as
with latest_sent as (
    select distinct on (ticker)
        ticker, score as sentiment_score, themes, catalyst, risk
    from public.news_sentiments
    order by ticker, summarized_at desc, id desc
)
select
    n.*,
    s.sentiment_score,
    s.themes,
    s.catalyst,
    s.risk
from public.news_cache n
left join latest_sent s on s.ticker = n.ticker;

-- ── rpc: recommendation_accuracy(days_after int) ──
create or replace function public.recommendation_accuracy(days_after integer default 3)
returns table (
    ticker             varchar,
    recommendation     varchar,
    analysed_at        timestamptz,
    price_at_rec       double precision,
    price_after        double precision,
    days_after         integer,
    actual_change_pct  double precision,
    correct            boolean
)
language sql
stable
set search_path = public
as $$
with daily as (
    -- last non-empty recommendation per ticker per WIB calendar day
    -- (025_accuracy_daily_dedupe: cycle-level scoring overweighted the
    -- most-analyzed tickers)
    select distinct on (a.ticker, (a.analysed_at at time zone 'Asia/Jakarta')::date)
           a.ticker, a.recommendation, a.analysed_at
    from public.llm_analyses a
    where a.recommendation is not null
      and a.recommendation not in ('UNKNOWN', '')
    order by a.ticker,
             (a.analysed_at at time zone 'Asia/Jakarta')::date,
             a.analysed_at desc
),
recent as (
    select ticker, recommendation, analysed_at
    from daily
    order by analysed_at desc
    limit 100
),
priced as (
    select
        r.ticker,
        r.recommendation,
        r.analysed_at,
        (select s.current_price
           from public.stock_snapshots s
          where s.ticker = r.ticker
            and s.fetched_at <= r.analysed_at
            and s.current_price is not null
          order by s.fetched_at desc
          limit 1) as price_at_rec,
        (select s.current_price
           from public.stock_snapshots s
          where s.ticker = r.ticker
            and s.fetched_at >= r.analysed_at + make_interval(days => days_after)
            and s.current_price is not null
          order by s.fetched_at asc
          limit 1) as price_after
    from recent r
)
select
    p.ticker,
    p.recommendation,
    p.analysed_at,
    p.price_at_rec,
    p.price_after,
    days_after as days_after,
    round((((p.price_after - p.price_at_rec) / p.price_at_rec) * 100)::numeric, 2)::double precision
        as actual_change_pct,
    case
        when p.recommendation in ('BUY','BUY SEKARANG','BELI','AVERAGE DOWN')
            then ((p.price_after - p.price_at_rec) / p.price_at_rec) * 100 > 0
        when p.recommendation in ('CUT LOSS','JUAL','TRIM','TAKE PROFIT')
            then ((p.price_after - p.price_at_rec) / p.price_at_rec) * 100 < 0
        when p.recommendation in ('HOLD','TUNGGU','MONITOR')
            then abs(((p.price_after - p.price_at_rec) / p.price_at_rec) * 100) < 5
        else null
    end as correct
from priced p
where p.price_at_rec is not null
  and p.price_at_rec <> 0
  and p.price_after is not null
  and p.price_after <> 0;
$$;

-- Manual price-refresh signal: web inserts a row, the graph drains it on its
-- next tick and forces a refetch. kind routes to the matching refresh service
-- (stock/gold/fund). See migrations/003_price_refresh_requests.sql and
-- migrations/014_refresh_requests_kind.sql.
create table if not exists public.price_refresh_requests (
    id           bigint generated always as identity primary key,
    requested_at timestamptz not null default now(),
    processed_at timestamptz,
    kind         text not null default 'stock' check (kind in ('stock', 'gold', 'fund'))
);

-- ── Auth ──
-- RLS removed (migration 035). Auth enforced by NextAuth + Next.js middleware.
-- Backend connects as DB owner — no row-level restrictions needed.

-- ── MULTI-AGENT ANALYSIS QUEUE (migration 026) ──
-- analysis_jobs: one deep run (run_id) = N persona jobs + 1 consensus job,
-- claimed atomically by the worker via claim_analysis_job().
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

-- Atomic claim: one job per call; consensus jobs claimable only when their
-- run's persona jobs are all terminal.
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

create index if not exists ix_portfolio_positions_active on public.portfolio_positions (active) where active = true;
create index if not exists ix_portfolio_positions_updated on public.portfolio_positions (updated_at desc);

create index if not exists ix_gold_purchases_active on public.gold_purchases (active) where active = true;
create index if not exists ix_fund_purchases_active on public.fund_purchases (active) where active = true;

create index if not exists ix_bond_holdings_active on public.bond_holdings (active) where active = true;
create index if not exists ix_bond_holdings_maturity on public.bond_holdings (maturity_date);

insert into public.schema_migrations (version, name) values ('034', '034_add_missing_indexes') on conflict do nothing;

-- ── NextAuth tables (migration 036) ──
create table if not exists public.users (
  id serial primary key,
  name varchar(255),
  email varchar(255) unique,
  "emailVerified" timestamptz,
  image text,
  password_hash text not null
);

create table if not exists public.accounts (
  id serial primary key,
  "userId" integer not null references public.users(id) on delete cascade,
  type varchar(255) not null,
  provider varchar(255) not null,
  "providerAccountId" varchar(255) not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  id_token text,
  scope text,
  session_state text,
  token_type text
);

create table if not exists public.sessions (
  id serial primary key,
  "userId" integer not null references public.users(id) on delete cascade,
  expires timestamptz not null,
  "sessionToken" varchar(255) not null unique
);

create table if not exists public.verification_token (
  identifier text not null,
  expires timestamptz not null,
  token text not null,
  primary key (identifier, token)
);

insert into public.schema_migrations (version, name) values ('036', '036_nextauth_tables') on conflict do nothing;
