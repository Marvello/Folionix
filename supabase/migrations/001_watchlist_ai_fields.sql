-- Add AI-suggestion metadata columns to watchlist (idempotent).
alter table public.watchlist add column if not exists sector text default '';
alter table public.watchlist add column if not exists rationale text default '';
