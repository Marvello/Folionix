---
okf_version: "0.2"
---

# Folionix Knowledge Bundle

OKF v0.2 knowledge bundle for Folionix — an Indonesian stock portfolio (IDX)
analyzer. Concepts are organized by type: tables, datasets, metrics, and
pipelines. Supabase is the source of truth.

## Sections

- [Tables](tables/index.md) — base Supabase tables
- [Datasets](datasets/index.md) — views, external feeds, derived datasets
- [Metrics](metrics/index.md) — computed quantities
- [Pipelines](pipelines/index.md) — orchestration and processing flows
- [Decisions](decisions.md) — rationale behind implemented features (the "why")
- [Runbooks](runbooks/supabase-foundation.md) — operational bootstrap (Supabase foundation)
- [Log](log.md) — dated record of drift fixes and sync passes

## Flow at a glance

[yahoo-finance2](datasets/yahoo-finance2-market-data.md) /
[Finnhub](datasets/finnhub-quotes.md) →
[stock_snapshots](tables/stock-snapshots.md) → LLM →
[llm_analyses](tables/llm-analyses.md) → Telegram, coordinated by the
[orchestrator](pipelines/orchestrator.md). News flows from
[RSS feeds](datasets/news-rss-feeds.md) → [news_cache](tables/news-cache.md) →
[news_sentiments](tables/news-sentiments.md) and is injected into analysis prompts.
Stock positions are transaction-backed: every BUY/SELL fill is a row in
[stock_transactions](tables/stock-transactions.md) (source of truth), and a
Postgres trigger recomputes [portfolio_positions](tables/portfolio-positions.md)
(avg price, lots, `realized_pnl`) on every write — `portfolio_positions` is
now a derived cache, not the source of truth. Upcoming dividends are tracked separately in
[dividend_schedule](tables/dividend-schedule.md) (IDX-sourced via got-scraping
with yahoo amount backfill, manual override preserved, daily sync with ex-date H-1
and pay-date Telegram reminders) — forecast only, distinct from paid
[stock_dividends](tables/stock-dividends.md). Gold is tracked separately, per
venue: [Cermati](pipelines/gold-holdings.md) →
[gold_snapshots](tables/gold-snapshots.md) values [gold_purchases](tables/gold-purchases.md)
(netted buys − sells via its `side` column) at the venue sell-back price —
no LLM/news involved. Mutual funds follow the same shape:
[Cermati](pipelines/fund-navs.md) → [fund_snapshots](tables/fund-snapshots.md)
values [fund_purchases](tables/fund-purchases.md) (netted buys − sells via
its `side` column) at the fund's latest NAV per unit (plus a
[fund_catalog](tables/fund-catalog.md) upsert powering web autocomplete;
[fund_product_summary](datasets/fund-product-summary.md) aggregates per fund
with `realized_pnl`). Non-IDR funds are converted with daily
[forex_rates](tables/forex-rates.md) (open.er-api → `latest_forex_rates`). Bonds have no price feed at all —
[bond_holdings](tables/bond-holdings.md) is valued at its own `principal`
(par value). Funds and bonds are both tracking-only (no LLM/news) and
**web-only for writes** — the bot's `/flist`/`/blist` are read-only (and now
read netted holdings + realized P&L). Income —
[stock_dividends](tables/stock-dividends.md),
[fund_distributions](tables/fund-distributions.md), and bond coupons — is
kept separate from capital (unrealized + realized P&L) in the web
dashboard's Capital-vs-Income split, and account-level fees
([account_charges](tables/account-charges.md)) subtract as a third term:
**Total Return = Capital + Income − Fees**. Per-trade stock fees are instead
folded into cost basis (migration 020).
