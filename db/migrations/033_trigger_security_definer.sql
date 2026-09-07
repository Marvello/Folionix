-- 033: make stock_transactions trigger SECURITY DEFINER
-- recompute_stock_position EXECUTE is granted only to service_role (migration 027).
-- The trigger fires as the invoking user (authenticated), which lacks permission.
-- SECURITY DEFINER runs the trigger function as its owner (postgres), fixing this.

create or replace function public.trg_stock_txn_recompute_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (tg_op = 'DELETE') then
        perform public.recompute_stock_position(old.ticker);
        return null;
    end if;
    if (tg_op = 'UPDATE' and old.ticker is distinct from new.ticker) then
        perform public.recompute_stock_position(old.ticker);
    end if;
    perform public.recompute_stock_position(new.ticker);
    return null;
end;
$$;

insert into public.schema_migrations (version, name)
values ('033', '033_trigger_security_definer')
on conflict do nothing;
