---
type: pipeline
title: fund NAVs
description: Provider-per-source mutual-fund NAV refresh + holdings valuation at latest NAV per unit.
resource: app/src/services/funds.ts
tags: [pipeline, cli, funds, price, idempotent]
generated:
  by: human:marvellooni
  at: 2026-07-08T00:00:00Z
status: stable
---

# fund NAVs

`refreshFundNavs` in `app/src/services/funds.ts` does one paginated REST sweep of
`invest.cermati.com/api/v2/mutual-funds/products` (configurable via `CERMATI_MF_URL`).
Each item carries `currentNav` + `lastUpdatedNav`, so no per-fund detail call is needed.
Upserts the whole batch into [fund_catalog](../tables/fund-catalog.md)
(the autocomplete universe), then inserts one
[fund_snapshots](../tables/fund-snapshots.md) row per fund — idempotent on
`(fund_code, nav_at)`. Also driven by the [orchestrator runner](orchestrator.md#product-refresh-schedule)
daily at ≥ 17:00 WIB (alongside `refreshGoldPrices`, once NAV is final after
close) and on-demand when a `fund` [refresh request](../tables/price-refresh-requests.md)
is queued (which also refreshes forex).

`listFundHoldings` (read-only valuation) nets each fund's `BUY` minus
`SELL` rows in [fund_purchases](../tables/fund-purchases.md)
(weighted-average, via the `side` column added migration 017), values the
remaining units at the fund's latest NAV per unit from
[latest_fund_navs](../datasets/latest-fund-navs.md) — never the buy NAV —
to compute cost, current value, and unrealized P&L, and reports realized
P&L from `SELL` rows separately (mirrored in the
[fund_product_summary](../datasets/fund-product-summary.md) view). Used by
both the Telegram bot (`/flist`, read-only, now shows netted holdings +
realized) and the web `/funds` page (full CRUD; funds are added by
searching `fund_catalog`).

## Related

- Cermati NAV fetch lives in `app/src/providers/cermati.ts`; it is the only registered
  source today.
- No LLM/news involvement — price tracking only, unlike the stock pipelines.
- Mirrors [gold-holdings](gold-holdings.md) in shape (provider-per-source
  sweep → snapshot table → read-only valuation module), but funds also
  maintain a `fund_catalog` upsert for web autocomplete, which gold does not.
