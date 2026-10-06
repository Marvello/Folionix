-- 043: query-path indexes and view rewrites (review 2026-10-06, P2-DB1/2/3/5/6/7).
-- Bodies of recompute_stock_position, recommendation_accuracy and
-- fund_product_summary are copied from db/schema.sql with only the commented
-- lines changed.

-- ── stock_snapshots: per-ticker time index; latest-per-ticker via loose index scan ──
create index if not exists ix_snapshots_ticker_fetched
    on public.stock_snapshots (ticker, fetched_at desc, id desc);
drop index if exists public.ix_snapshots_ticker;   -- prefix of the index above

-- One index probe per distinct ticker instead of sorting the whole append-only table.
create or replace view public.latest_snapshots with (security_invoker = true) as
with recursive t(ticker) as (
    (select ticker from public.stock_snapshots order by ticker limit 1)
    union all
    select (select s.ticker from public.stock_snapshots s
             where s.ticker > t.ticker order by s.ticker limit 1)
    from t where t.ticker is not null
)
select l.*
from t
cross join lateral (
    select * from public.stock_snapshots s
     where s.ticker = t.ticker
     order by s.fetched_at desc, s.id desc
     limit 1
) l
where t.ticker is not null;

-- ── news / sentiment / analyses: indexes matching the ORDER BY of their readers ──
create index if not exists ix_news_published        on public.news_cache (published_at desc);
create index if not exists ix_news_ticker_published on public.news_cache (ticker, published_at desc);
drop index if exists public.ix_news_ticker;
create index if not exists ix_sentiments_ticker_at  on public.news_sentiments (ticker, summarized_at desc, id desc);
drop index if exists public.ix_sentiments_ticker;
create index if not exists ix_analyses_ticker_at    on public.llm_analyses (ticker, analysed_at desc, id desc);
drop index if exists public.ix_analyses_ticker;

-- Per-row lateral lookup instead of DISTINCT ON over all of news_sentiments.
create or replace view public.news_with_latest_sentiment with (security_invoker = true) as
select
    n.*,
    s.sentiment_score,
    s.themes,
    s.catalyst,
    s.risk
from public.news_cache n
left join lateral (
    select ns.score as sentiment_score, ns.themes, ns.catalyst, ns.risk
      from public.news_sentiments ns
     where ns.ticker = n.ticker
     order by ns.summarized_at desc, ns.id desc
     limit 1
) s on true;

-- ── FK indexes: snapshot deletes (retention) no longer seq-scan these tables ──
create index if not exists ix_analyses_snapshot on public.llm_analyses (snapshot_id);
create index if not exists ix_persona_snapshot  on public.persona_analyses (snapshot_id);

-- ── fund_snapshots: nav_at is part of the upsert key; NULLs never conflict ──
delete from public.fund_snapshots where nav_at is null;
alter table public.fund_snapshots alter column nav_at set not null;
create or replace view public.latest_fund_navs with (security_invoker = true) as
select distinct on (fund_code) *
from public.fund_snapshots
order by fund_code, nav_at desc, id desc;

create or replace view public.fund_product_summary with (security_invoker = true) as
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
    -- float sums leave ~1e-15 after a full sell; round so a sold-out fund reads 0
    round((b.buy_units - coalesce(s.sell_units, 0))::numeric, 8)::double precision as total_units,
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
      -- only the last 100 days are graded; don't DISTINCT ON all of history
      and a.analysed_at >= now() - interval '120 days'
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
    -- Serialize recomputes per ticker: two concurrent ledger writes would each
    -- fold their own snapshot and the last upsert would drop the other's row.
    perform pg_advisory_xact_lock(hashtext('recompute_stock_position:' || p_ticker));
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

insert into public.schema_migrations (version, name)
values ('043', '043_query_paths') on conflict do nothing;
