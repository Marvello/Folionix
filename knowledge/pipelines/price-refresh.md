---
type: pipeline
title: price refresh
description: Price-only snapshot refresh (no LLM/news/Telegram) so dashboard prices are never null; idempotent via the cache.
resource: app/src/services/portfolio.ts
tags: [pipeline, cli, price, idempotent]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# price refresh

`prices.refresh_prices` fetches + saves a [stock_snapshots](../tables/stock-snapshots.md)
row per target (portfolio + watchlist, or an explicit list). Never raises —
counts `{fetched, cached, errors}`. Cache-aware via `CACHE_MINUTES`; `force`
bypasses it (manual refetch). `refresh_missing` self-heals tickers with no
snapshot (e.g. a web-added position).

Entry `npm run prices [TICKERS]` (`runPriceRefresh`). Also called inline by the bot on
`/add` and `/wadd`, and once at orchestrator startup.

## Related

- Targets union the [active portfolio](../datasets/active-portfolio.md) and
  [watchlist](../tables/watchlist.md).
- Triggered on demand via the [orchestrator](orchestrator.md) draining
  [price_refresh_requests](../tables/price-refresh-requests.md).
