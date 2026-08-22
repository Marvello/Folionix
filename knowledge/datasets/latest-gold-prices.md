---
type: dataset
title: latest_gold_prices
description: View exposing the single most-recent gold_snapshots row per venue.
resource: supabase/schema.sql
tags: [supabase, view, gold]
generated:
  by: human:marvellooni
  at: 2026-06-19T00:00:00Z
status: stable
---

# latest_gold_prices

`select distinct on (venue) * from gold_snapshots order by venue, id desc`.
Gives the bot (`/gprice`) and web `/gold` page one current price row per
venue without a per-query subselect.

## Related

- Derived from the [gold_snapshots](../tables/gold-snapshots.md) table.
- Read by `db.get_latest_gold_price`; used by `app.gold.holdings` to value
  [gold_purchases](../tables/gold-purchases.md) at the venue sell-back price.
