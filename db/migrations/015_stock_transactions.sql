-- supabase/migrations/015_stock_transactions.sql
-- Stock transaction ledger. stock_transactions is the source of truth;
-- portfolio_positions is a derived cache recomputed by a trigger on every
-- write (web writes directly to Supabase, so the recompute must live in the DB).

-- ── stock_transactions ──
create table if not exists public.stock_transactions (
    id         bigserial primary key,
    ticker     varchar(10)      not null,
    side       varchar(4)       not null check (side in ('BUY','SELL')),
    lots       integer          not null check (lots > 0),   -- 1 lot = 100 shares
    price      double precision not null,                    -- executed IDR/share
    fee        double precision not null default 0,          -- broker fee IDR
    txn_at     timestamptz      not null,
    notes      text             default '',
    created_at timestamptz      not null default now()
);
create index if not exists ix_stock_txn_ticker
    on public.stock_transactions (ticker, txn_at);

-- ── portfolio_positions: realized P&L cache column ──
alter table public.portfolio_positions
    add column if not exists realized_pnl double precision not null default 0;

-- ── recompute function ──
-- Folds all of a ticker's transactions (oldest first) into the cache.
-- Weighted average: SELL keeps avg, reduces lots, realizes (price-avg)*lots*100.
create or replace function public.recompute_stock_position(p_ticker varchar)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r          record;
    v_lots     integer := 0;
    v_avg      double precision := 0;
    v_realized double precision := 0;
    v_new_lots integer;
    v_sell     integer;
    v_notes    text;
begin
    for r in
        select side, lots, price
        from public.stock_transactions
        where ticker = p_ticker
        order by txn_at asc, id asc
    loop
        if r.side = 'BUY' then
            v_new_lots := v_lots + r.lots;
            v_avg := (v_avg * v_lots + r.price * r.lots) / v_new_lots;
            v_lots := v_new_lots;
        else
            v_sell := least(r.lots, v_lots);
            v_realized := v_realized + (r.price - v_avg) * v_sell * 100;
            v_lots := v_lots - v_sell;
            if v_lots = 0 then v_avg := 0; end if;
        end if;
    end loop;

    -- preserve any existing notes on the position row
    select notes into v_notes from public.portfolio_positions where ticker = p_ticker;

    insert into public.portfolio_positions
        (ticker, avg_price, lots, realized_pnl, active, notes, updated_at)
    values
        (p_ticker, v_avg, v_lots, v_realized, v_lots > 0, coalesce(v_notes, ''), now())
    on conflict (ticker) do update set
        avg_price    = excluded.avg_price,
        lots         = excluded.lots,
        realized_pnl = excluded.realized_pnl,
        active       = excluded.active,
        updated_at   = excluded.updated_at;
end;
$$;

-- ── trigger ──
create or replace function public.trg_stock_txn_recompute_fn()
returns trigger
language plpgsql
as $$
begin
    if (tg_op = 'UPDATE' and old.ticker is distinct from new.ticker) then
        perform public.recompute_stock_position(old.ticker);
    end if;
    perform public.recompute_stock_position(coalesce(new.ticker, old.ticker));
    return null;
end;
$$;

drop trigger if exists trg_stock_txn_recompute on public.stock_transactions;
create trigger trg_stock_txn_recompute
    after insert or update or delete on public.stock_transactions
    for each row execute function public.trg_stock_txn_recompute_fn();

-- ── backfill: one opening BUY per existing active position ──
insert into public.stock_transactions (ticker, side, lots, price, fee, txn_at, notes)
select p.ticker, 'BUY', p.lots, p.avg_price, 0, coalesce(p.updated_at, now()),
       'opening balance (backfill)'
from public.portfolio_positions p
where p.active = true
  and p.lots > 0
  and not exists (
      select 1 from public.stock_transactions t where t.ticker = p.ticker
  );

-- ── RLS ──
alter table public.stock_transactions enable row level security;
drop policy if exists rw_stock_transactions on public.stock_transactions;
create policy rw_stock_transactions on public.stock_transactions
    for all to authenticated using (true) with check (true);
