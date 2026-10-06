-- 048: recompute the positions cache once per statement, not once per row
-- (review P2-DB7). recompute_stock_position re-folds a ticker's whole ledger, so
-- the row-level trigger made an N-row import O(N^2). Statement-level triggers with
-- transition tables recompute each affected ticker exactly once; the result is the
-- same (the cache is a pure function of the ledger).
drop trigger if exists trg_stock_txn_recompute on public.stock_transactions;

create or replace function public.trg_stock_txn_recompute_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    t varchar;
begin
    -- Only the transition tables declared for this event exist, hence the branches.
    if tg_op = 'INSERT' then
        for t in select distinct ticker from new_rows loop
            perform public.recompute_stock_position(t);
        end loop;
    elsif tg_op = 'DELETE' then
        for t in select distinct ticker from old_rows loop
            perform public.recompute_stock_position(t);
        end loop;
    else
        for t in select ticker from old_rows union select ticker from new_rows loop
            perform public.recompute_stock_position(t);
        end loop;
    end if;
    return null;
end;
$$;

create trigger trg_stock_txn_recompute_ins
    after insert on public.stock_transactions
    referencing new table as new_rows
    for each statement execute function public.trg_stock_txn_recompute_stmt();
create trigger trg_stock_txn_recompute_upd
    after update on public.stock_transactions
    referencing old table as old_rows new table as new_rows
    for each statement execute function public.trg_stock_txn_recompute_stmt();
create trigger trg_stock_txn_recompute_del
    after delete on public.stock_transactions
    referencing old table as old_rows
    for each statement execute function public.trg_stock_txn_recompute_stmt();

drop function if exists public.trg_stock_txn_recompute_fn();

insert into public.schema_migrations (version, name)
values ('048', '048_position_recompute_per_statement') on conflict do nothing;
