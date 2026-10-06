-- 045: stock_snapshots rows written 2026-06-12..06-30 by a legacy writer hold
-- div_yield_pct 100x too large (TLKM 926 for 9.26%). Already so before 040, which
-- only rescaled fractions (<= 1). Every row in that window is > 20 and none after
-- it is, so the window + threshold pins exactly those rows.
update public.stock_snapshots
   set div_yield_pct = div_yield_pct / 100
 where fetched_at < '2026-07-01'
   and div_yield_pct > 20;

insert into public.schema_migrations (version, name)
values ('045', '045_june_div_yield_scale') on conflict do nothing;
