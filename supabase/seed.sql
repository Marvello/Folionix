-- IDX Portfolio — static bootstrap seed (edit by hand, or manage live via bot/web).
-- Optional: apply to a fresh Supabase to pre-load positions/watchlist.
-- Idempotent: ON CONFLICT (ticker) DO NOTHING.
--
-- NOTE: the values below are illustrative sample data, not real holdings.
-- Replace avg_price / lots with your own, or manage everything via the bot/web UI.

-- ── portfolio_positions ──
insert into public.portfolio_positions (ticker, avg_price, lots, active, notes, updated_at) values ('BBCA', 9000.00, 1, true, 'BCA retail banking, blue chip', now()) on conflict (ticker) do nothing;
insert into public.portfolio_positions (ticker, avg_price, lots, active, notes, updated_at) values ('BMRI', 5000.00, 1, true, 'Bank Mandiri, state bank', now()) on conflict (ticker) do nothing;
insert into public.portfolio_positions (ticker, avg_price, lots, active, notes, updated_at) values ('TLKM', 3000.00, 1, true, 'Telkom, defensive telco', now()) on conflict (ticker) do nothing;

-- ── watchlist ──
insert into public.watchlist (ticker, kind, notes, added_at) values ('BBRI', 'user', 'BRI microfinance & rural banking, state bank', '2026-01-01') on conflict (ticker) do nothing;
