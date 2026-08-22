# Tables

Base Supabase tables (`supabase_local/schema.sql`).

- [stock_snapshots](stock-snapshots.md) — per-ticker market + position snapshot
- [llm_analyses](llm-analyses.md) — LLM recommendations linked to snapshots
- [news_cache](news-cache.md) — deduplicated fetched articles
- [news_sentiments](news-sentiments.md) — LLM-summarized news sentiment
- [stock_transactions](stock-transactions.md) — stock BUY/SELL ledger (source of truth for stock positions)
- [portfolio_positions](portfolio-positions.md) — owned positions (derived cache, recomputed from stock_transactions)
- [stock_dividends](stock-dividends.md) — dividend income per stock
- [dividend_schedule](dividend-schedule.md) — upcoming dividend dates per stock (forecast, yahoo-sourced)
- [watchlist](watchlist.md) — user / AI-suggested tickers to watch
- [price_refresh_requests](price-refresh-requests.md) — manual refresh signal queue
- [gold_purchases](gold-purchases.md) — gold holdings per purchase, buy/sell (source of truth)
- [gold_snapshots](gold-snapshots.md) — per-venue gold price history
- [fund_catalog](fund-catalog.md) — mutual-fund universe for web autocomplete
- [fund_snapshots](fund-snapshots.md) — per-fund NAV-per-unit history
- [fund_purchases](fund-purchases.md) — mutual-fund holdings per purchase, buy/sell (source of truth)
- [fund_distributions](fund-distributions.md) — fund distribution income
- [bond_holdings](bond-holdings.md) — bond holdings, valued at par (source of truth)
- [forex_rates](forex-rates.md) — daily FX-to-IDR rates for foreign-currency fund valuation
- [account_charges](account-charges.md) — account-level fees (reduce Total Return)
- [weekly_reviews](weekly-reviews.md) — generated week-review reports (markdown + handover doc + stats)

Infra-only (not OKF domain concepts): `schema_migrations` (migration ledger,
see CLAUDE.md → Conventions).
