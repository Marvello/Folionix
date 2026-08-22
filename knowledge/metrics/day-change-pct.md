---
type: metric
title: day change %
description: Intraday move versus previous close, in IDR and percent.
resource: app/src/providers/market.ts
tags: [price, market-data, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# day change %

In `market.fetch_stock`:

- `day_change` = `round(current - prev_close, 0)`
- `day_change_pct` = `round(day_change / prev_close × 100, 2)`

Both are `None` when price or previous close is missing. A `day_arrow`
(▲ / ▼ / ─) is attached for display.

## Related

- Stored on [stock_snapshots](../tables/stock-snapshots.md).
- Primary input to the [market signal](market-signal.md) price-move tier in the
  [orchestrator](../pipelines/orchestrator.md).
