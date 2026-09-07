-- ── fund_product_summary (aggregate fund_purchases per fund_code) ──
create or replace view public.fund_product_summary with (security_invoker = true) as
select
    fp.fund_code,
    max(fp.fund_name)                                                         as fund_name,
    max(fc.fund_type)                                                         as fund_type,
    max(fc.investment_manager)                                                as investment_manager,
    max(fp.currency)                                                          as currency,
    sum(fp.units)                                                             as total_units,
    sum(fp.units * fp.buy_nav_per_unit) / nullif(sum(fp.units), 0)           as avg_buy_nav,
    sum(fp.units * fp.buy_nav_per_unit)                                       as total_cost,
    fn.nav                                                                    as latest_nav,
    fn.nav_at                                                                 as nav_at,
    sum(fp.units) * fn.nav                                                    as current_value,
    sum(fp.units) * fn.nav - sum(fp.units * fp.buy_nav_per_unit)             as pnl,
    case
        when sum(fp.units * fp.buy_nav_per_unit) > 0
        then (sum(fp.units) * fn.nav - sum(fp.units * fp.buy_nav_per_unit))
              / sum(fp.units * fp.buy_nav_per_unit) * 100
    end                                                                       as pnl_pct,
    count(*)::int                                                             as transaction_count,
    min(fp.purchased_at)                                                      as first_purchased_at
from public.fund_purchases fp
left join public.latest_fund_navs fn on fn.fund_code = fp.fund_code
left join public.fund_catalog fc on fc.code = fp.fund_code
where fp.active = true
group by fp.fund_code, fn.nav, fn.nav_at;

-- ── bond_product_summary (aggregate bond_holdings per series_code) ──
create or replace view public.bond_product_summary with (security_invoker = true) as
select
    bh.series_code,
    max(bh.series_type)                                                       as series_type,
    sum(bh.principal)                                                         as total_principal,
    sum(bh.purchase_price)                                                    as total_purchase_cost,
    sum(bh.principal * bh.coupon_rate) / nullif(sum(
        case when bh.coupon_rate is not null then bh.principal else 0 end
    ), 0)                                                                     as avg_coupon_rate,
    sum(bh.principal * coalesce(bh.coupon_rate, 0) / 100)                   as annual_income,
    max(bh.maturity_date)                                                     as maturity_date,
    count(*)::int                                                             as transaction_count,
    min(bh.purchased_at)                                                      as first_purchased_at
from public.bond_holdings bh
where bh.active = true
group by bh.series_code;
