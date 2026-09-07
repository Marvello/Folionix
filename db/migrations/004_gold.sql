-- 004_gold.sql — gold portfolio: per-purchase holdings + per-venue price history

create table if not exists public.gold_purchases (
    id                 bigserial primary key,
    venue              varchar(30) not null,        -- matches a code-side provider key
    grams              double precision not null,   -- weight in grams
    buy_price_per_gram double precision not null,   -- IDR/g actually paid
    purchased_at       timestamptz not null,
    active             boolean default true,
    notes              text default '',
    updated_at         timestamptz not null
);

create table if not exists public.gold_snapshots (
    id         bigserial primary key,
    venue      varchar(30) not null,
    buy_price  double precision,   -- venue "you buy at" price/g (higher)
    sell_price double precision,   -- venue "you sell back at" price/g (lower)
    mid_price  double precision,
    price_at   timestamptz,        -- provider's own timestamp
    fetched_at timestamptz not null
);

create index if not exists ix_gold_snapshots_venue_fetched
    on public.gold_snapshots (venue, fetched_at desc);

create or replace view public.latest_gold_prices as
select distinct on (venue) *
from public.gold_snapshots
order by venue, id desc;

-- RLS: anon denied; authenticated read+write purchases, read prices; service role bypasses
alter table public.gold_purchases enable row level security;
alter table public.gold_snapshots enable row level security;

drop policy if exists rw_gold_purchases on public.gold_purchases;
create policy rw_gold_purchases on public.gold_purchases
    for all to authenticated using (true) with check (true);

drop policy if exists read_gold_snapshots on public.gold_snapshots;
create policy read_gold_snapshots on public.gold_snapshots
    for select to authenticated using (true);
