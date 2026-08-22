-- Drop all Supabase RLS policies and disable RLS on all tables.
-- Auth enforcement moves to NextAuth + Next.js middleware.
-- Backend connects as the DB owner (no RLS needed).

-- ── Drop policies ──
drop policy if exists read_snapshots on public.stock_snapshots;
drop policy if exists read_analyses on public.llm_analyses;
drop policy if exists read_news on public.news_cache;
drop policy if exists read_sentiments on public.news_sentiments;
drop policy if exists rw_portfolio on public.portfolio_positions;
drop policy if exists rw_watchlist on public.watchlist;
drop policy if exists rw_stock_transactions on public.stock_transactions;
drop policy if exists rw_stock_dividends on public.stock_dividends;
drop policy if exists rw_fund_distributions on public.fund_distributions;
drop policy if exists rw_refresh_requests on public.price_refresh_requests;
drop policy if exists rw_gold_purchases on public.gold_purchases;
drop policy if exists read_gold_snapshots on public.gold_snapshots;
drop policy if exists read_fund_catalog on public.fund_catalog;
drop policy if exists read_fund_holdings on public.fund_holdings;
drop policy if exists read_fund_snapshots on public.fund_snapshots;
drop policy if exists rw_fund_purchases on public.fund_purchases;
drop policy if exists rw_bond_holdings on public.bond_holdings;
drop policy if exists rw_account_charges on public.account_charges;
drop policy if exists read_analysis_jobs on public.analysis_jobs;
drop policy if exists read_persona_analyses on public.persona_analyses;

-- ── Disable RLS ──
alter table public.price_refresh_requests disable row level security;
alter table public.stock_snapshots disable row level security;
alter table public.llm_analyses disable row level security;
alter table public.news_cache disable row level security;
alter table public.news_sentiments disable row level security;
alter table public.portfolio_positions disable row level security;
alter table public.watchlist disable row level security;
alter table public.gold_purchases disable row level security;
alter table public.gold_snapshots disable row level security;
alter table public.fund_catalog disable row level security;
alter table public.fund_holdings disable row level security;
alter table public.fund_snapshots disable row level security;
alter table public.fund_purchases disable row level security;
alter table public.bond_holdings disable row level security;
alter table public.stock_transactions disable row level security;
alter table public.stock_dividends disable row level security;
alter table public.fund_distributions disable row level security;
alter table public.account_charges disable row level security;
alter table public.analysis_jobs disable row level security;
alter table public.persona_analyses disable row level security;

-- ── Revoke Supabase-specific role grants ──
-- These roles (anon, authenticated, service_role) are Supabase-specific.
-- After migration to standard Postgres, the app connects as the DB owner directly.
-- These REVOKE statements are safe even if the roles don't exist (will no-op with IF EXISTS pattern).
do $$
begin
  -- Revoke function execute grants from Supabase roles
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.claim_analysis_job(integer) from anon;
    revoke execute on function public.recompute_stock_position(varchar) from anon;
    revoke execute on function public.recommendation_accuracy(integer) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.claim_analysis_job(integer) from authenticated;
    revoke execute on function public.recompute_stock_position(varchar) from authenticated;
    revoke execute on function public.recommendation_accuracy(integer) from authenticated;
  end if;
end $$;

-- Functions keep SECURITY DEFINER but no longer need Supabase role restrictions.
-- Grant execute to PUBLIC (standard Postgres default).
grant execute on function public.claim_analysis_job(integer) to public;
grant execute on function public.recompute_stock_position(varchar) to public;
grant execute on function public.recommendation_accuracy(integer) to public;

insert into public.schema_migrations (version, name)
values ('035', '035_drop_rls')
on conflict do nothing;
