-- recommendation_accuracy: score HOLD-ish calls against IHSG instead of an
-- absolute band, and label each row with its rec_class.
--
-- The old rule marked HOLD/MONITOR correct whenever |move| < 5% over N days.
-- IDX large-cap 3-day volatility sits around 2-3%, so that band was a free
-- pass: 86% of recommendations landed in the HOLD-ish bucket and scored 92%,
-- while the six actionable calls in the same sample scored 33%. The blended
-- number measured how quiet the market was, not whether the desk was right.
-- Worse, it ran backwards for held positions — a HOLD on PTBA that then rose
-- 11% was marked wrong for being right about direction.
--
-- HOLD means "I did nothing", so the honest question is whether doing nothing
-- cost anything relative to the market: correct when the ticker tracked IHSG
-- within hold_band_pct. BUY-ish and SELL-ish stay absolute — those transact,
-- and their alternative is cash, not the index.
--
-- Falls back to the old absolute band when no ^JKSE snapshot brackets the
-- window, so early history and any IHSG gap still score instead of going null.
-- The signature and return type both change, so the old function has to go
-- first: `create or replace` cannot alter a return type, and leaving the
-- 1-arg version in place would make recommendation_accuracy(3) ambiguous
-- against the new defaulted 2-arg form. Dropping discards its grants, so the
-- grant migration 035 settled on is re-applied at the bottom.
drop function if exists public.recommendation_accuracy(integer);

-- `or replace` so this is also a no-op re-run against a database bootstrapped
-- from db/schema.sql, which already carries this definition.
create or replace function public.recommendation_accuracy(
    days_after     integer default 3,
    hold_band_pct  double precision default 1.5
)
returns table (
    ticker               varchar,
    recommendation       varchar,
    rec_class            text,
    analysed_at          timestamptz,
    price_at_rec         double precision,
    price_after          double precision,
    days_after           integer,
    actual_change_pct    double precision,
    benchmark_change_pct double precision,
    correct              boolean
)
language sql
stable
set search_path = public
as $$
with daily as (
    -- last non-empty recommendation per ticker per WIB calendar day
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
    where ticker <> '^JKSE'   -- the benchmark does not grade itself
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
          limit 1) as price_after,
        (select s.current_price
           from public.stock_snapshots s
          where s.ticker = '^JKSE'
            and s.fetched_at <= r.analysed_at
            and s.current_price is not null
          order by s.fetched_at desc
          limit 1) as bench_at_rec,
        (select s.current_price
           from public.stock_snapshots s
          where s.ticker = '^JKSE'
            and s.fetched_at >= r.analysed_at + make_interval(days => days_after)
            and s.current_price is not null
          order by s.fetched_at asc
          limit 1) as bench_after
    from recent r
),
classified as (
    select
        p.*,
        case
            when p.recommendation in ('BUY','BUY SEKARANG','BELI','AVERAGE DOWN') then 'BUY-ISH'
            when p.recommendation in ('CUT LOSS','JUAL','TRIM','TAKE PROFIT')     then 'SELL-ISH'
            when p.recommendation in ('HOLD','TUNGGU','MONITOR')                  then 'HOLD-ISH'
        end as rec_class,
        ((p.price_after - p.price_at_rec) / p.price_at_rec) * 100 as move_pct,
        case
            when p.bench_at_rec is not null and p.bench_at_rec <> 0
                 and p.bench_after is not null
            then ((p.bench_after - p.bench_at_rec) / p.bench_at_rec) * 100
        end as bench_pct
    from priced p
    where p.price_at_rec is not null
      and p.price_at_rec <> 0
      and p.price_after is not null
      and p.price_after <> 0
)
select
    c.ticker,
    c.recommendation,
    c.rec_class,
    c.analysed_at,
    c.price_at_rec,
    c.price_after,
    days_after as days_after,
    round(c.move_pct::numeric, 2)::double precision  as actual_change_pct,
    round(c.bench_pct::numeric, 2)::double precision as benchmark_change_pct,
    case c.rec_class
        when 'BUY-ISH'  then c.move_pct > 0
        when 'SELL-ISH' then c.move_pct < 0
        when 'HOLD-ISH' then
            case
                when c.bench_pct is not null then abs(c.move_pct - c.bench_pct) < hold_band_pct
                else abs(c.move_pct) < 5   -- no benchmark bracketing the window
            end
    end as correct
from classified c;
$$;

-- Re-apply the grant dropped with the old function. Migration 035 moved this
-- off the Supabase roles (anon/authenticated/service_role no longer exist) to
-- the plain-Postgres default: EXECUTE to public, with the backend connecting
-- as the DB owner.
grant execute on function public.recommendation_accuracy(integer, double precision) to public;

insert into public.schema_migrations (version, name)
values ('037', '037_accuracy_benchmark_relative') on conflict do nothing;
