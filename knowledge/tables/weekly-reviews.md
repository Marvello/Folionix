---
type: table
title: weekly_reviews
description: Generated weekly review reports — portfolio WoW numbers plus AI self-review markdown, and a raw-data handover doc for external LLMs.
resource: supabase/schema.sql
tags: [supabase, review, report, llm, email]
generated:
  by: human:marvellooni
  at: 2026-07-14T00:00:00Z
status: stable
---

# weekly_reviews

One row per generated week review (migration `023_weekly_reviews.sql`).
Columns: `week_start`/`week_end` (dates), `report_md` (full markdown report:
portfolio week-over-week numbers, recommendation ledger, local-LLM
self-critique), `handover_md` (raw-data handover document formatted for a
stronger external LLM to suggest system improvements), `stats` (jsonb:
net_worth, wow_pct, rec_total, rec_changed, accuracy_pct, …), `model`,
`emailed`, `created_at`. Indexed on `week_end desc`.

Written only by the backend (`saveWeeklyReview` in `app/src/db/db.ts`,
service role); RLS grants authenticated `select` only — the web `/reviews`
page renders `report_md`/`handover_md` read-only.

## Related

- Produced by the [week-review](../pipelines/week-review.md) pipeline.
- Numbers computed via the shared `lib/aggregate.ts` (same math as the web
  dashboard) plus week-ago prices from [stock_snapshots](stock-snapshots.md),
  [gold_snapshots](gold-snapshots.md), and [fund_snapshots](fund-snapshots.md).
- Uses the [recommendation accuracy](../metrics/recommendation-accuracy.md)
  RPC and the week's [llm_analyses](llm-analyses.md) rows for the ledger.
