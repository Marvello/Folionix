create index if not exists ix_portfolio_positions_active on public.portfolio_positions (active) where active = true;
create index if not exists ix_portfolio_positions_updated on public.portfolio_positions (updated_at desc);

create index if not exists ix_gold_purchases_active on public.gold_purchases (active) where active = true;
create index if not exists ix_fund_purchases_active on public.fund_purchases (active) where active = true;

create index if not exists ix_bond_holdings_active on public.bond_holdings (active) where active = true;
create index if not exists ix_bond_holdings_maturity on public.bond_holdings (maturity_date);

insert into public.schema_migrations (version, name) values ('034', '034_add_missing_indexes') on conflict do nothing;
