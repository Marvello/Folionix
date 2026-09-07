-- Account-level charges not attributable to any single holding: broker data
-- subscription, monthly stamp duty (meterai), late fees, etc. These reduce
-- total return on the dashboard (Total Return = Capital + Income − Fees) but
-- are NOT capital or per-asset income.
create table if not exists public.account_charges (
    id         bigserial primary key,
    charged_at date             not null,
    type       varchar(20)      not null
               check (type in ('DATA_FEE','METERAI','LATE_FEE','OTHER')),
    amount     double precision not null,       -- IDR charged
    notes      text             default '',
    created_at timestamptz      not null default now()
);
create index if not exists ix_account_charges_date
    on public.account_charges (charged_at desc);

alter table public.account_charges enable row level security;
drop policy if exists rw_account_charges on public.account_charges;
create policy rw_account_charges on public.account_charges
    for all to authenticated using (true) with check (true);
