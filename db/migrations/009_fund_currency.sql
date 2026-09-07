-- Add currency to fund_purchases so multi-currency funds (e.g. USD) are
-- stored and displayed correctly. Existing rows default to 'IDR'.
alter table public.fund_purchases
    add column if not exists currency varchar(5) not null default 'IDR';
