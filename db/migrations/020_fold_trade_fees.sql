-- Fold trade fees into stock cost basis.
-- Supersedes the recompute_stock_position defined in migration 015: a BUY now
-- adds its fee to the cost of the shares acquired (raising avg_price), and a
-- SELL's fee reduces realized P&L. This makes position P&L match the broker's
-- netamount (amount ± fee). Safe to run on a DB that already applied 015 —
-- it redefines the function and re-runs it for every existing ticker.

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
    -- avg_price is per share; fees are folded into cost basis. A BUY adds its
    -- fee to the cost of the shares acquired; a SELL's fee reduces realized P&L.
    for r in
        select side, lots, price, fee
        from public.stock_transactions
        where ticker = p_ticker
        order by txn_at asc, id asc
    loop
        if r.side = 'BUY' then
            v_new_lots := v_lots + r.lots;
            v_avg := (v_avg * v_lots * 100 + r.price * r.lots * 100 + r.fee)
                     / (v_new_lots * 100);
            v_lots := v_new_lots;
        else
            v_sell := least(r.lots, v_lots);
            v_realized := v_realized + (r.price - v_avg) * v_sell * 100 - r.fee;
            v_lots := v_lots - v_sell;
            if v_lots = 0 then v_avg := 0; end if;
        end if;
    end loop;

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

-- Refresh every existing position with the fee-folded formula.
do $$
declare t varchar;
begin
    for t in select distinct ticker from public.stock_transactions loop
        perform public.recompute_stock_position(t);
    end loop;
end $$;
