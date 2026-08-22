---
type: table
title: fund_purchases
description: Per-purchase mutual-fund holdings — fund, platform, units, buy NAV per unit, and purchase date.
resource: supabase/migrations/005_funds_bonds.sql
tags: [supabase, funds, source-of-truth]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# fund_purchases

The canonical record of mutual-fund units owned. One row per purchase (not
deduped per fund — multiple purchases of the same fund are separate rows).
Columns: `fund_code` (FK to [fund_catalog](fund-catalog.md).`code`),
`fund_name` (denormalized at purchase time), `platform` (where bought —
Bibit, Bareksa, …), `units`, `buy_nav_per_unit`, `purchased_at`, `active`,
`notes`, `updated_at`, `currency` (varchar, default `IDR`; added migration 009
so USD and other multi-currency funds valued via [forex rates](../pipelines/forex-rates.md)),
and (added in migration 017) `side` (`BUY`/`SELL`, checked, default `BUY`). A `SELL` row reuses `units`/`buy_nav_per_unit` as
the disposal units/executed sale NAV per unit. Removal is a soft delete
(`active = false`).

Managed **web-only** via the `/funds` page (add via `fund_catalog`
autocomplete search, edit/remove via modal); authenticated read/write under
RLS, backend bypasses RLS via the service role. The Telegram bot's `/flist`
only reads — there is no `/fadd`/`/fremove`.

## Related

- Read by `app.funds.holdings.list_holdings`/`summary`, which net `BUY`
  minus `SELL` rows (weighted-average) and value the remaining units at the
  fund's latest NAV per unit from [fund_snapshots](fund-snapshots.md) (via
  `latest_fund_navs`).
- Aggregated per fund by [fund_product_summary](../datasets/fund-product-summary.md),
  which nets sells and exposes `realized_pnl`.
- Drives the [fund-navs](../pipelines/fund-navs.md) valuation flow.
