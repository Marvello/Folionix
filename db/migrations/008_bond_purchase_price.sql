alter table public.bond_holdings
  add column if not exists purchase_price double precision;
