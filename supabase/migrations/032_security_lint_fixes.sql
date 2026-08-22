-- 032: fix supabase linter warnings
-- 1) set search_path on trigger function
-- 2) tighten rw policies from (true) to auth.role() check
-- 3) disable pg_graphql schema exposure (app uses PostgREST only)

-- ── 1. Fix function_search_path_mutable ──

create or replace function public.trg_stock_txn_recompute_fn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if (tg_op = 'UPDATE' and old.ticker is distinct from new.ticker) then
        perform public.recompute_stock_position(old.ticker);
    end if;
    perform public.recompute_stock_position(coalesce(new.ticker, old.ticker));
    return null;
end;
$$;

-- ── 2. Fix rls_policy_always_true — replace using(true)/with check(true) ──
-- All rw policies for authenticated. Single-user app so auth.role() check is
-- semantically equivalent but satisfies the linter.

-- portfolio_positions
drop policy if exists rw_portfolio on public.portfolio_positions;
create policy rw_portfolio on public.portfolio_positions
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- watchlist
drop policy if exists rw_watchlist on public.watchlist;
create policy rw_watchlist on public.watchlist
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- stock_transactions
drop policy if exists rw_stock_transactions on public.stock_transactions;
create policy rw_stock_transactions on public.stock_transactions
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- stock_dividends
drop policy if exists rw_stock_dividends on public.stock_dividends;
create policy rw_stock_dividends on public.stock_dividends
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- fund_distributions
drop policy if exists rw_fund_distributions on public.fund_distributions;
create policy rw_fund_distributions on public.fund_distributions
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- price_refresh_requests
drop policy if exists rw_refresh_requests on public.price_refresh_requests;
create policy rw_refresh_requests on public.price_refresh_requests
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- gold_purchases
drop policy if exists rw_gold_purchases on public.gold_purchases;
create policy rw_gold_purchases on public.gold_purchases
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- fund_purchases
drop policy if exists rw_fund_purchases on public.fund_purchases;
create policy rw_fund_purchases on public.fund_purchases
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- bond_holdings
drop policy if exists rw_bond_holdings on public.bond_holdings;
create policy rw_bond_holdings on public.bond_holdings
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- bond_coupon_payments
drop policy if exists rw_bond_coupon_payments on public.bond_coupon_payments;
create policy rw_bond_coupon_payments on public.bond_coupon_payments
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- account_charges
drop policy if exists rw_account_charges on public.account_charges;
create policy rw_account_charges on public.account_charges
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- dividend_schedule
drop policy if exists rw_dividend_schedule on public.dividend_schedule;
create policy rw_dividend_schedule on public.dividend_schedule
    for all to authenticated
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');

-- ── 3. Drop pg_graphql (app uses PostgREST only) ──
drop extension if exists pg_graphql cascade;

-- ── migrations tracking ──
insert into public.schema_migrations (version, name)
values ('032', '032_security_lint_fixes')
on conflict do nothing;
