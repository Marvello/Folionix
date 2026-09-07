-- Bond coupon payment log. Each row records one actual coupon receipt for a holding.
-- P&L = sum(payments) + accrued_since_last_payment + capital_gain_at_maturity.
create table if not exists public.bond_coupon_payments (
    id              bigserial primary key,
    bond_holding_id bigint           not null references public.bond_holdings(id),
    amount          double precision not null,
    paid_at         date             not null,  -- date coupon cash arrived
    notes           text             default '',
    created_at      timestamptz      not null
);

create index if not exists ix_bond_coupon_payments_holding
    on public.bond_coupon_payments (bond_holding_id, paid_at desc);

-- RLS: same policy as bond_holdings — authenticated users read/write their own rows.
alter table public.bond_coupon_payments enable row level security;
drop policy if exists rw_bond_coupon_payments on public.bond_coupon_payments;
create policy rw_bond_coupon_payments on public.bond_coupon_payments
    for all to authenticated using (true) with check (true);
