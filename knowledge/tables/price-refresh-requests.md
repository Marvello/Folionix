---
type: table
title: price_refresh_requests
description: Manual price-refresh signal — the web UI inserts a row, the orchestrator drains pending rows and forces a refetch.
resource: supabase/schema.sql
tags: [supabase, signal, price-refresh]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# price_refresh_requests

A lightweight work queue. The web "Refetch prices" button inserts a row;
`db.claim_pending_refresh` marks all rows with a null `processed_at` as
processed (coalescing many clicks into one refresh) and returns whether any
were pending. Columns: `requested_at`, `processed_at`.

## Related

- Drained by the [orchestrator](../pipelines/orchestrator.md) tick, which then
  runs a forced [price-refresh](../pipelines/price-refresh.md).
