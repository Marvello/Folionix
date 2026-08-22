---
type: pipeline
title: forex rates
description: Daily FX-to-IDR rate refresh (USD/SGD/EUR/JPY/MYR) used to value foreign-currency fund holdings.
resource: app/src/services/forex.ts
tags: [pipeline, forex, price, idempotent]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# forex rates

`refreshForexRates` in `app/src/services/forex.ts` fetches each base currency's
IDR rate from `open.er-api.com/v6/latest/<CUR>` (free, no key, includes IDR) for
`USD`, `SGD`, `EUR`, `JPY`, `MYR` and upserts one `forex_rates` row per currency
— idempotent on `(base_currency, quote_currency, rate_at)`, so re-running the
same WIB day overwrites rather than duplicates. Per-currency `withRetry`
(3× / 500ms); a single currency failure is logged and skipped, not fatal.

Driven by the [orchestrator runner](orchestrator.md#product-refresh-schedule)
daily at ≥ 09:00 WIB (market open) and again whenever a `fund`
[refresh request](../tables/price-refresh-requests.md) is claimed — fund
valuation in a foreign currency needs a current rate, so `refreshFundNavs` and
`refreshForexRates` run back-to-back on that queue.

## Related

- No LLM/news involvement — price tracking only, like [gold holdings](gold-holdings.md)
  and [fund NAVs](fund-navs.md).
- Consumed by fund valuation for holdings priced in a non-IDR currency.
