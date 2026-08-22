---
type: metric
title: distance from 52-week range
description: Percent distance of current price from the 52-week high and low.
resource: app/src/providers/market.ts
tags: [price, technical, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# distance from 52-week range

In `market.fetch_stock`:

- `dist_from_high` = `round((current / high_52w - 1) × 100, 1)` (≤ 0)
- `dist_from_low` = `round((current / low_52w - 1) × 100, 1)` (≥ 0)

Each is `None` when the corresponding bound is missing.

## Related

- Stored on [stock_snapshots](../tables/stock-snapshots.md).
- Feeds the technical section of the
  [watchlist-analysis](../pipelines/watchlist-analysis.md) prompt.
