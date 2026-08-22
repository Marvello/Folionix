---
type: table
title: gold_purchases
description: Per-purchase gold holdings — venue, grams, buy price per gram, and purchase date.
resource: supabase/schema.sql
tags: [supabase, gold, source-of-truth]
generated:
  by: human:marvellooni
  at: 2026-07-08T00:00:00Z
status: stable
---

# gold_purchases

The canonical record of gold lots owned. One row per purchase (not deduped
per venue — multiple purchases at the same venue are separate rows).
Columns: `venue` (matches a code-side provider key registered in
`app.gold.registry`, e.g. `cermati`), `grams`, `buy_price_per_gram` (IDR/g
actually paid), `purchased_at`, `active`, `notes`, `updated_at`, and (added
in migration 017) `side` (`BUY`/`SELL`, checked, default `BUY`). A `SELL`
row reuses `grams`/`buy_price_per_gram` as the disposal grams/executed sale
price per gram.

Managed via the Telegram bot (`/gadd`, `/gremove`, `/glist`) and the web `/gold`
page; authenticated read/write under RLS, backend bypasses RLS via the service
role.

## Related

- Read by `app.gold.holdings.list_holdings`/`summary`, which net `BUY` minus
  `SELL` rows (weighted-average) and value the remaining grams at the
  venue's latest sell-back price from [gold_snapshots](gold-snapshots.md)
  (via `latest_gold_prices`); realized P&L from `SELL` rows feeds the web
  dashboard's Capital figure.
- Drives the [gold-holdings](../pipelines/gold-holdings.md) valuation flow.
