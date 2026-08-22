---
type: dataset
title: latest_forex_rates
description: Newest exchange rate per currency pair — one row per (base, quote).
resource: supabase/migrations/010_forex_rates.sql
tags: [supabase, view, forex]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# latest_forex_rates

`distinct on (base_currency, quote_currency)` over
[forex_rates](../tables/forex-rates.md), ordered by `rate_at desc, id desc` —
so exactly one row per pair, the most recent effective date. Declared
`security_invoker = true` (runs under the caller's RLS, mirroring the other
`latest_*` views).

## Related

- The read side of the [forex-rates pipeline](../pipelines/forex-rates.md);
  fund valuation joins it to convert non-IDR fund holdings to IDR.
- Mirrors [latest_gold_prices](latest-gold-prices.md) and
  [latest_fund_navs](latest-fund-navs.md) in shape (newest-per-key view).
