-- 040: stock_snapshots.div_yield_pct held yahoo's fraction (0.05) despite its name, so
-- scores.ts and the persona prompts read 5% as 0.05%. The app now writes a percent;
-- convert the existing rows once. Values are never > 1 as a fraction (a 100% yield).
update public.stock_snapshots
set div_yield_pct = div_yield_pct * 100
where div_yield_pct is not null and div_yield_pct <= 1;

insert into public.schema_migrations (version, name)
values ('040', '040_div_yield_percent') on conflict do nothing;
