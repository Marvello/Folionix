-- 029_fund_metrics
--
-- The Cermati catalog response already carries per-fund market metrics and a
-- slug (needed for the per-fund detail/holdings endpoint), but the refresh only
-- persisted NAV. Capture the rest: static classification stays on fund_catalog,
-- point-in-time metrics ride on each NAV snapshot (so history is preserved and
-- flows through latest_fund_navs, which is `select *`).

alter table public.fund_catalog
    add column if not exists slug text;

alter table public.fund_snapshots
    add column if not exists aum           double precision,  -- currentAum
    add column if not exists expense_ratio double precision,  -- percent, e.g. 2.41
    add column if not exists cagr          double precision,  -- percent, best-horizon CAGR
    add column if not exists ret_1m        double precision,  -- oneMonthNav (percent)
    add column if not exists ret_3m        double precision,  -- threeMonthNav
    add column if not exists ret_ytd       double precision,  -- yearToDateNav
    add column if not exists ret_1y        double precision;  -- oneYearNav

insert into public.schema_migrations (version, name)
values ('029', '029_fund_metrics') on conflict do nothing;
