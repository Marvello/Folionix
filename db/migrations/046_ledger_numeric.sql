-- 046: ledger money/quantity columns double precision -> numeric (review P2-DB4).
-- These are values the user entered (prices paid, fees, units, grams, coupons);
-- float sums drifted (a fully sold fund kept ~1e-15 units). Market-data tables
-- (snapshots, NAV history) stay float — they are approximate by nature.
-- fund_product_summary is the only view over these columns: drop, alter, recreate
-- (definition unchanged from 043). Both pg pools parse numeric (OID 1700) to
-- JS numbers, so callers are unaffected.

drop view if exists public.fund_product_summary;

alter table public.stock_transactions
    alter column price type numeric using price::numeric,
    alter column fee type numeric using fee::numeric;
alter table public.portfolio_positions
    alter column avg_price type numeric using avg_price::numeric,
    alter column realized_pnl type numeric using realized_pnl::numeric;
alter table public.gold_purchases
    alter column grams type numeric using grams::numeric,
    alter column buy_price_per_gram type numeric using buy_price_per_gram::numeric;
alter table public.fund_purchases
    alter column units type numeric using units::numeric,
    alter column buy_nav_per_unit type numeric using buy_nav_per_unit::numeric;
alter table public.account_charges
    alter column amount type numeric using amount::numeric;
alter table public.stock_dividends
    alter column amount type numeric using amount::numeric,
    alter column per_share type numeric using per_share::numeric;
alter table public.fund_distributions
    alter column amount type numeric using amount::numeric;
alter table public.bond_holdings
    alter column principal type numeric using principal::numeric,
    alter column purchase_price type numeric using purchase_price::numeric,
    alter column coupon_rate type numeric using coupon_rate::numeric;
alter table public.bond_coupon_payments
    alter column amount type numeric using amount::numeric;

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

create or replace function public.recompute_stock_position(p_ticker varchar)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r          record;
    v_lots     integer := 0;
    v_avg      numeric := 0;   -- exact: no float drift across many BUY/SELL rows
    v_realized numeric := 0;
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
values ('046', '046_ledger_numeric') on conflict do nothing;
