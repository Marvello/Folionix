-- 031_fund_nav_view_metrics
--
-- latest_fund_navs was created as `select distinct on (fund_code) *` BEFORE
-- migration 029 added the metric columns to fund_snapshots. Postgres freezes
-- `*` expansion at view-creation time, so the view never exposed aum /
-- expense_ratio / cagr / ret_* even though the base table now has them.
-- Recreate the view so `*` re-expands over the current column set.
create or replace view public.latest_fund_navs with (security_invoker = true) as
select distinct on (fund_code) *
from public.fund_snapshots
order by fund_code, nav_at desc nulls last, id desc;

insert into public.schema_migrations (version, name)
values ('031', '031_fund_nav_view_metrics') on conflict do nothing;
