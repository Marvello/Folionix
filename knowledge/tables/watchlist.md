---
type: table
title: watchlist
description: Tickers to watch but not (yet) owned — user-added or AI-suggested, with sector and rationale.
resource: supabase/schema.sql
tags: [supabase, watchlist]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# watchlist

One row per `ticker` (unique constraint `uq_watchlist_ticker`). `kind` is
checked to be `user` or `ai_suggested`. Columns: `notes`, `sector`,
`rationale`, `added_at`. Replaces the former `watchlist.json`.

Managed via the bot (`/wadd`, `/wremove`, `/wlist`) and web UI; AI suggestions
are bulk-replaced by `db.replace_ai_suggestions`.

## Related

- Analyzed by the [watchlist-analysis](../pipelines/watchlist-analysis.md)
  pipeline (BUY NOW / WAIT / AVOID verdicts).
- Included as price-refresh targets by [price-refresh](../pipelines/price-refresh.md).
