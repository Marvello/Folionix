-- Fundamentals for the stock detail page: key stats, quarterly financials,
-- and corporate actions.
--
-- These move on quarterly and event-driven clocks while prices move every
-- five minutes, so they do not share storage with stock_snapshots. Widening
-- that table would rewrite ~30 static values on every price tick and bloat
-- the series ai/indicators.ts reads.
--
-- Every metric column is nullable: thin IDX small-caps genuinely have no
-- analyst coverage and no published quarterly statements.

create table if not exists public.stock_key_stats (
    ticker                 varchar(20) primary key,
    fetched_at             timestamptz not null default now(),
    forward_pe             double precision,
    peg_ratio              double precision,
    price_to_book          double precision,
    enterprise_value       double precision,
    book_value             double precision,
    trailing_eps           double precision,
    forward_eps            double precision,
    profit_margins         double precision,
    ebitda_margins         double precision,
    return_on_equity       double precision,
    revenue_growth         double precision,
    earnings_growth        double precision,
    current_ratio          double precision,
    quick_ratio            double precision,
    total_cash             double precision,
    total_debt             double precision,
    free_cashflow          double precision,
    operating_cashflow     double precision,
    target_mean            double precision,
    target_high            double precision,
    target_low             double precision,
    recommendation_key     varchar(24),
    analyst_count          integer,
    shares_outstanding     double precision,
    float_shares           double precision,
    held_pct_insiders      double precision,
    held_pct_institutions  double precision,
    change_52w             double precision
);

create table if not exists public.stock_financials (
    ticker                varchar(20) not null,
    period_end            date        not null,
    -- 'QUARTERLY' | 'ANNUAL'. Only QUARTERLY is populated initially; ANNUAL
    -- exists because period_type is part of the key, not as future scope.
    period_type           varchar(10) not null,
    revenue               double precision,
    cost_of_revenue       double precision,
    gross_profit          double precision,
    operating_income      double precision,
    net_income            double precision,
    eps                   double precision,
    gross_margin_pct      double precision,
    operating_margin_pct  double precision,
    net_margin_pct        double precision,
    currency              varchar(3),
    source                varchar(24) not null default 'yahoo',
    fetched_at            timestamptz not null default now(),
    primary key (ticker, period_end, period_type)
);

create table if not exists public.corporate_actions (
    id          bigint generated always as identity primary key,
    ticker      varchar(20) not null,
    -- SPLIT | RIGHTS | BONUS | RUPS. Only SPLIT is populated initially; the
    -- IDX-scraped types land later as inserts, not as a schema change.
    type        varchar(16) not null,
    event_date  date        not null,
    ex_date     date,
    -- New shares per old share: a 1:2 split (1 becomes 2) is 2.0,
    -- a 1:10 reverse split is 0.1.
    ratio       numeric,
    amount      numeric,
    details     jsonb       not null default '{}',
    source      varchar(24) not null,
    synced_at   timestamptz not null default now(),
    unique (ticker, type, event_date)
);

create index if not exists idx_stock_financials_ticker_period
    on public.stock_financials (ticker, period_end desc);
create index if not exists idx_corporate_actions_ticker_date
    on public.corporate_actions (ticker, event_date desc);

-- dividend_schedule is deliberately NOT migrated: it works and the Telegram
-- bot's ex-date and pay-date reminders read it. The view presents both
-- sources as one timeline so the UI has a single read path.
create or replace view public.corporate_actions_all
with (security_invoker = true) as
select ticker,
       'DIVIDEND'::varchar(16) as type,
       ex_date                 as event_date,
       ex_date,
       null::numeric           as ratio,
       amount_per_share        as amount,
       jsonb_build_object('cum_date', cum_date,
                          'pay_date', pay_date,
                          'estimated', amount_estimated) as details,
       source
  from public.dividend_schedule
union all
select ticker, type, event_date, ex_date, ratio, amount, details, source
  from public.corporate_actions;

insert into public.schema_migrations (version, name)
values ('039', '039_fundamentals') on conflict do nothing;
