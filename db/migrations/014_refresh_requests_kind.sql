-- Generalize price_refresh_requests to also carry manual "refetch" signals
-- for gold and fund prices, not just stocks. The graph orchestrator polls
-- by kind and triggers the matching refresh service.
alter table public.price_refresh_requests
    add column if not exists kind text not null default 'stock';

alter table public.price_refresh_requests drop constraint if exists price_refresh_requests_kind_check;
alter table public.price_refresh_requests
    add constraint price_refresh_requests_kind_check check (kind in ('stock', 'gold', 'fund'));

create index if not exists idx_refresh_requests_kind_pending
    on public.price_refresh_requests (kind) where processed_at is null;
