---
type: table
title: gold_snapshots
description: Per-venue gold price history — buy/sell/mid price per gram at a point in time.
resource: supabase/schema.sql
tags: [supabase, gold, snapshot]
generated:
  by: human:marvellooni
  at: 2026-06-19T00:00:00Z
status: stable
---

# gold_snapshots

Append-only log of per-venue gold price fetches. One row per fetch per venue
(`fetched_at`, `venue`). Written by
[refresh_gold_prices](../pipelines/gold-holdings.md) via `db.save_gold_snapshot`;
the freshest row per venue is exposed through the
[latest_gold_prices](../datasets/latest-gold-prices.md) view.

## Columns of note

- `buy_price` — venue "you buy at" price per gram (higher).
- `sell_price` — venue "you sell back at" price per gram (lower); used to
  value holdings.
- `mid_price` — venue midpoint price per gram.
- `price_at` — the provider's own timestamp for the quote.

Index on `(venue, fetched_at desc)`.

## Related

- [gold_purchases](gold-purchases.md) holdings are valued against this
  table's freshest `sell_price` per venue.
- Produced by the [gold-holdings](../pipelines/gold-holdings.md) pipeline
  (`refreshGoldPrices` in `app/src/services/gold.ts`), idempotent within `CACHE_MINUTES`.
