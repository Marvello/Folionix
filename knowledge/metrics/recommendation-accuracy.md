---
type: metric
title: recommendation accuracy
description: Backtest of past LLM recommendations against actual price movement N days later.
resource: supabase/schema.sql
tags: [recommendation, accuracy, backtest, rpc, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# recommendation accuracy

Postgres RPC `recommendation_accuracy(days_after int default 3)` over the last
100 scored recommendations, **deduped to one per ticker per WIB day** (the
day's last non-empty rec; migration `025_accuracy_daily_dedupe` — cycle-level
scoring overweighted the most-analyzed tickers). For each it finds
`price_at_rec` (latest snapshot at/before the analysis) and `price_after`
(earliest snapshot ≥ analysis + `days_after`), computes `actual_change_pct`,
and judges `correct`:

- BUY / BELI / AVERAGE DOWN → price went up
- CUT LOSS / JUAL / TRIM / TAKE PROFIT → price went down
- HOLD / TUNGGU / MONITOR → moved < 5% either way

## Related

- Reads [llm_analyses](../tables/llm-analyses.md) and
  [stock_snapshots](../tables/stock-snapshots.md).
- Called via `getRecommendationAccuracy` (`app/src/db/db.ts`) from the
  [week-review](../pipelines/week-review.md) pipeline, and read directly by the
  web ticker detail page.
