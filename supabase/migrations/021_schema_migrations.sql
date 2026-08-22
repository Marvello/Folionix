-- Migration ledger: records which numbered migrations have been applied, so
-- "is 020 run yet?" is answered by SELECT, not by memory. Every migration file
-- from here on ends with an insert of its own row (see CLAUDE.md → Conventions).
create table if not exists public.schema_migrations (
    version    varchar          primary key,   -- '021'
    name       text             not null,      -- '021_schema_migrations'
    applied_at timestamptz      not null default now()
);

alter table public.schema_migrations enable row level security;
drop policy if exists ro_schema_migrations on public.schema_migrations;
create policy ro_schema_migrations on public.schema_migrations
    for select to authenticated using (true);   -- read-only audit; service role bypasses

-- Backfill: migrations 001-021 are already applied on this database.
insert into public.schema_migrations (version, name) values
    ('001', '001_watchlist_ai_fields'),
    ('002', '002_latest_analyses_view'),
    ('003', '003_price_refresh_requests'),
    ('004', '004_gold'),
    ('005', '005_funds_bonds'),
    ('006', '006_security_invoker_views'),
    ('007', '007_fund_nav_ordering'),
    ('008', '008_bond_purchase_price'),
    ('009', '009_fund_currency'),
    ('010', '010_forex_rates'),
    ('011', '011_bond_coupon_payments'),
    ('012', '012_bond_coupon_schedule'),
    ('013', '013_product_summary_views'),
    ('014', '014_refresh_requests_kind'),
    ('015', '015_stock_transactions'),
    ('016', '016_stock_dividends'),
    ('017', '017_gold_fund_side'),
    ('018', '018_fund_distributions'),
    ('019', '019_account_charges'),
    ('020', '020_fold_trade_fees'),
    ('021', '021_schema_migrations')
on conflict (version) do nothing;
