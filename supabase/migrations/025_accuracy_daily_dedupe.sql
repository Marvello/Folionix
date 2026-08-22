-- recommendation_accuracy: score one recommendation per ticker per WIB day
-- (the day's last), instead of every 30-minute analysis cycle. Cycle-level
-- scoring overweighted whichever tickers were analyzed most (watchlist rows
-- dominated 35/43 of the sample) and let alternating recs stuff the stat.
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

insert into public.schema_migrations (version, name)
values ('025', '025_accuracy_daily_dedupe') on conflict do nothing;
