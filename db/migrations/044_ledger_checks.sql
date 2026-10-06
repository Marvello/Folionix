-- 044: sanity CHECKs on money/quantity ledger columns (review 2026-10-06, P2-DB12).
-- NOT VALID: enforced for every new or updated row, without re-validating history
-- (a single bad legacy row must not block startup). To also check existing rows:
--   alter table public.<t> validate constraint <name>;
alter table public.stock_transactions
    add constraint ck_stock_txn_price_nonneg check (price >= 0) not valid,   -- 0 = bonus shares
    add constraint ck_stock_txn_fee_nonneg check (fee >= 0) not valid;
alter table public.gold_purchases
    add constraint ck_gold_grams_pos check (grams > 0) not valid,
    add constraint ck_gold_price_pos check (buy_price_per_gram > 0) not valid;
alter table public.fund_purchases
    add constraint ck_fund_units_pos check (units > 0) not valid,
    add constraint ck_fund_nav_pos check (buy_nav_per_unit > 0) not valid;
alter table public.account_charges
    add constraint ck_charge_amount_pos check (amount > 0) not valid;
alter table public.stock_dividends
    add constraint ck_stock_div_amount_pos check (amount > 0) not valid;
alter table public.fund_distributions
    add constraint ck_fund_dist_amount_pos check (amount > 0) not valid;
alter table public.bond_holdings
    add constraint ck_bond_principal_pos check (principal > 0) not valid;
alter table public.bond_coupon_payments
    add constraint ck_coupon_amount_pos check (amount > 0) not valid;

insert into public.schema_migrations (version, name)
values ('044', '044_ledger_checks') on conflict do nothing;
