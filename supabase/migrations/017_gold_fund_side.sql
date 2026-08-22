-- supabase/migrations/017_gold_fund_side.sql
-- Add buy/sell discriminator to gold and fund per-purchase tables. Default
-- 'BUY' so every existing row and any side-unaware reader is unaffected.
-- A SELL row reuses the price/qty columns as the executed sale price/qty.

alter table public.gold_purchases
    add column if not exists side varchar(4) not null default 'BUY'
        check (side in ('BUY','SELL'));

alter table public.fund_purchases
    add column if not exists side varchar(4) not null default 'BUY'
        check (side in ('BUY','SELL'));

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
