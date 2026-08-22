---
type: table
title: llm_analyses
description: LLM analysis output per ticker — recommendation, raw and cleaned text, and Telegram send/skip flags, linked to the snapshot it analyzed.
resource: supabase/schema.sql
tags: [supabase, llm, ollama, recommendation]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# llm_analyses

One row per LLM analysis. Foreign key `snapshot_id` references
[stock_snapshots](stock-snapshots.md). Stores `model`, `recommendation`,
`raw_output`, `clean_html` (Telegram HTML), and the alert bookkeeping flags
`sent_telegram` and `skipped_same`.

Written by `db.save_analysis`. Freshest row per ticker is exposed via the
[latest_analyses](../datasets/latest-analyses.md) view. Indexes on `ticker`
and `analysed_at`.

## Related

- Feeds the [recommendation accuracy](../metrics/recommendation-accuracy.md)
  metric (RPC joins recommendations back to snapshot prices).
- Populated by [portfolio-analysis](../pipelines/portfolio-analysis.md),
  [watchlist-analysis](../pipelines/watchlist-analysis.md), and the inner
  [analysis-graph](../pipelines/analysis-graph.md) pipelines.
