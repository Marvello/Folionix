-- KSEI-sourced coupon payment schedule for each bond holding.
-- Refreshed weekly (Mondays) by app.bonds.ksei.refresh_schedules().
create table if not exists bond_coupon_schedule (
    id          bigserial primary key,
    bond_holding_id bigint not null references bond_holdings(id) on delete cascade,
    series_code varchar(30) not null,
    distribution_date date not null,
    status      varchar(50),
    scraped_at  timestamptz default now(),
    unique (bond_holding_id, distribution_date)
);

create index if not exists idx_bcs_date on bond_coupon_schedule (distribution_date);

alter table bond_coupon_schedule enable row level security;
create policy "auth read bond_coupon_schedule"
    on bond_coupon_schedule for select
    using (auth.role() = 'authenticated');
