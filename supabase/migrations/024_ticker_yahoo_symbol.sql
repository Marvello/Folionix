-- Canonicalize stock tickers to the yahoo symbol form ('BBCA.JK', '^JKSE')
-- across every stock-related table. Storage now always carries the exchange
-- suffix (future-proof for non-IDX markets); the UI strips it for display.
-- This reverses the plain-ticker direction of 023-era data: history is mixed
-- ('ADRO' vs 'ADRO.JK'), which broke snapshot/analysis joins and left the
-- recommendation_accuracy RPC returning zero rows.
--
-- Rules: 'IHSG' → '^JKSE'; anything not starting with '^' and not already
-- ending in '.JK' gets '.JK' appended. Tables with unique ticker constraints
-- update guardedly; duplicate plain rows are cleaned up after recompute.

begin;

-- stock_transactions drives the portfolio_positions cache via trigger — hold
-- it during the rewrite, recompute once at the end.
alter table public.stock_transactions disable trigger trg_stock_txn_recompute;

-- ── IHSG alias → yahoo index symbol ──
update public.stock_snapshots     set ticker = '^JKSE' where upper(ticker) = 'IHSG';
update public.llm_analyses        set ticker = '^JKSE' where upper(ticker) = 'IHSG';
update public.news_cache          set ticker = '^JKSE' where upper(ticker) = 'IHSG';
update public.news_sentiments     set ticker = '^JKSE' where upper(ticker) = 'IHSG';
update public.stock_transactions  set ticker = '^JKSE' where upper(ticker) = 'IHSG';
update public.stock_dividends     set ticker = '^JKSE' where upper(ticker) = 'IHSG';
update public.watchlist w         set ticker = '^JKSE'
  where upper(w.ticker) = 'IHSG'
    and not exists (select 1 from public.watchlist x where x.ticker = '^JKSE');
update public.portfolio_positions p set ticker = '^JKSE'
  where upper(p.ticker) = 'IHSG'
    and not exists (select 1 from public.portfolio_positions x where x.ticker = '^JKSE');

-- ── append .JK to plain equity tickers ──
update public.stock_snapshots    set ticker = ticker || '.JK'
  where ticker not like '%.JK' and ticker not like '^%';
update public.llm_analyses       set ticker = ticker || '.JK'
  where ticker not like '%.JK' and ticker not like '^%';
update public.news_cache         set ticker = ticker || '.JK'
  where ticker is not null and ticker not like '%.JK' and ticker not like '^%';
update public.news_sentiments    set ticker = ticker || '.JK'
  where ticker not like '%.JK' and ticker not like '^%';
update public.stock_transactions set ticker = ticker || '.JK'
  where ticker not like '%.JK' and ticker not like '^%';
update public.stock_dividends    set ticker = ticker || '.JK'
  where ticker not like '%.JK' and ticker not like '^%';

-- unique (ticker): only rewrite when the .JK spelling is not already taken
update public.watchlist w set ticker = w.ticker || '.JK'
  where w.ticker not like '%.JK' and w.ticker not like '^%'
    and not exists (select 1 from public.watchlist x where x.ticker = w.ticker || '.JK');
update public.portfolio_positions p set ticker = p.ticker || '.JK'
  where p.ticker not like '%.JK' and p.ticker not like '^%'
    and not exists (select 1 from public.portfolio_positions x where x.ticker = p.ticker || '.JK');

-- unique (ticker, ex_date)
update public.dividend_schedule d set ticker = d.ticker || '.JK'
  where d.ticker not like '%.JK' and d.ticker not like '^%'
    and not exists (select 1 from public.dividend_schedule x
                     where x.ticker = d.ticker || '.JK' and x.ex_date = d.ex_date);
-- drop schedule rows whose .JK twin already existed (same forecast, IDX-refreshed)
delete from public.dividend_schedule d
  where d.ticker not like '%.JK' and d.ticker not like '^%'
    and exists (select 1 from public.dividend_schedule x
                 where x.ticker = d.ticker || '.JK' and x.ex_date = d.ex_date);

alter table public.stock_transactions enable trigger trg_stock_txn_recompute;

-- Rebuild the positions cache from the now-uniform ledger, then drop plain
-- position rows that have a .JK sibling (their transactions were folded into
-- the sibling by the recompute; keeping both would double-count).
select public.recompute_stock_position(t.ticker)
  from (select distinct ticker from public.stock_transactions) t;
delete from public.portfolio_positions p
  where p.ticker not like '%.JK' and p.ticker not like '^%'
    and exists (select 1 from public.portfolio_positions x where x.ticker = p.ticker || '.JK');
delete from public.watchlist w
  where w.ticker not like '%.JK' and w.ticker not like '^%'
    and exists (select 1 from public.watchlist x where x.ticker = w.ticker || '.JK');

commit;

insert into public.schema_migrations (version, name)
values ('024', '024_ticker_yahoo_symbol') on conflict do nothing;
