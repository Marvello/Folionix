---
type: dataset
title: latest_analyses
description: View exposing the most-recent llm_analyses row per ticker.
resource: supabase/schema.sql
tags: [supabase, view, llm]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# latest_analyses

`select distinct on (ticker) * from llm_analyses order by ticker, analysed_at
desc, id desc`. One current recommendation per ticker for the dashboard.

## Related

- Derived from the [llm_analyses](../tables/llm-analyses.md) table.
- Read by `db.get_latest_analyses`.
