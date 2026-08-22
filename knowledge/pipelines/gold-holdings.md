---
type: pipeline
title: gold holdings
description: Provider-per-venue gold price refresh + holdings valuation at venue sell-back price.
resource: app/src/services/gold.ts
tags: [pipeline, cli, gold, price, idempotent]
generated:
  by: human:marvellooni
  at: 2026-07-08T00:00:00Z
status: stable
---

# gold holdings

`refreshGoldPrices` in `app/src/services/gold.ts` calls the Cermati GraphQL endpoint
and saves a [gold_snapshots](../tables/gold-snapshots.md) row per venue. Cache-aware
via `CACHE_MINUTES`. Driven by the
[orchestrator runner](orchestrator.md#product-refresh-schedule) daily at
≥ 17:00 WIB and on-demand when a `gold`
[refresh request](../tables/price-refresh-requests.md) is queued.

`listGoldHoldings` (read-only valuation) nets each venue's `BUY` minus
`SELL` rows in [gold_purchases](../tables/gold-purchases.md)
(weighted-average, via the `side` column added migration 017), values the
remaining grams at the venue's latest `sell_price` from
[latest_gold_prices](../datasets/latest-gold-prices.md) — never the buy
price — to compute cost, current value, and unrealized P&L, and reports
realized P&L from `SELL` rows separately. Used by both the Telegram bot
(`/gadd`, `/glist`, `/gremove`, `/gprice`) and the web `/gold` page.

## Related

- Cermati GraphQL fetch lives in `app/src/providers/cermati.ts`; it is the only registered
  venue today (optional `CERMATI_COOKIE`).
- No LLM/news involvement — price tracking only, unlike the stock pipelines.
