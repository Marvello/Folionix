-- 007_fund_nav_ordering.sql — fix latest_fund_navs to pick by NAV date, not insertion order
--
-- get_latest_fund_nav() / latest_fund_navs previously ordered by fetched_at/id
-- (insertion order). A backfill or out-of-order sweep run could insert an
-- older nav_at after a newer one already exists, making "latest" show a
-- stale NAV. Order by nav_at desc (nulls last, since a fetch missing a NAV
-- date shouldn't shadow a dated one), tie-broken by id desc.

create or replace view public.latest_fund_navs with (security_invoker = true) as
select distinct on (fund_code) *
from public.fund_snapshots
order by fund_code, nav_at desc nulls last, id desc;
