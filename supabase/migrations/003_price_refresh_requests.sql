-- Manual "refetch prices" signal. The web UI inserts a row; the graph
-- orchestrator drains pending rows on its 10s tick and forces a price
-- refresh (bypassing the snapshot cache). Coalesced: many clicks = one refresh.
create table if not exists public.price_refresh_requests (
    id           bigint generated always as identity primary key,
    requested_at timestamptz not null default now(),
    processed_at timestamptz
);

alter table public.price_refresh_requests enable row level security;

-- Authenticated users (web UI) may request a refresh and read its status;
-- the backend service role bypasses RLS to process it.
drop policy if exists rw_refresh_requests on public.price_refresh_requests;
create policy rw_refresh_requests on public.price_refresh_requests
    for all to authenticated using (true) with check (true);
