---
type: table
title: forex_rates
description: Daily FX-to-IDR exchange rates per currency pair, used to value foreign-currency fund holdings.
resource: supabase/migrations/010_forex_rates.sql
tags: [supabase, forex, price]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# forex_rates

One row per `(base_currency, quote_currency, rate_at)`. Columns:
`base_currency`, `quote_currency` (always `IDR` today), `rate`, `rate_at`
(effective date, UTC), `fetched_at`. Unique index `ux_forex_rates_pair_date`
makes writes idempotent per day (re-running overwrites, never duplicates).
RLS: anon denied, authenticated read-only, service role bypasses.

Populated by the [forex-rates pipeline](../pipelines/forex-rates.md)
(`refreshForexRates`, `app/src/services/forex.ts`) for the bases
`USD, SGD, EUR, JPY, MYR`. **Note:** migration 010's comment says the source is
Finnhub, but the live service fetches from `open.er-api.com` (free, no key) —
the comment is stale, the code is correct.

## Related

- Newest row per pair is exposed by the
  [latest_forex_rates](../datasets/latest-forex-rates.md) view.
- Consumed by fund valuation ([fund-navs](../pipelines/fund-navs.md)) for
  holdings whose [fund_purchases](fund-purchases.md)`.currency` is not `IDR`.
