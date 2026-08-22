---
type: dataset
title: latest_snapshots
description: View exposing the single most-recent stock_snapshots row per ticker.
resource: supabase/schema.sql
tags: [supabase, view, market-data]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# latest_snapshots

`select distinct on (ticker) * from stock_snapshots order by ticker, id desc`.
Gives the dashboard and signal detection one current row per ticker without a
per-query subselect.

## Related

- Derived from the [stock_snapshots](../tables/stock-snapshots.md) table.
- Read by `db.get_all_latest_snapshots`; used by the
  [price-refresh](../pipelines/price-refresh.md) self-heal check and the web UI.
