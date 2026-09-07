---
type: metric
title: recommendation accuracy
description: Backtest of past LLM recommendations against actual price movement N days later; HOLD-ish calls score against IHSG rather than an absolute band.
resource: db/schema.sql
tags: [recommendation, accuracy, backtest, rpc, metric, benchmark]
generated:
  by: human:marvellooni
  at: 2026-09-07T00:00:00Z
status: stable
---

# recommendation accuracy

Postgres RPC `recommendation_accuracy(days_after int default 3, hold_band_pct
float default 1.5)` over the last 100 scored recommendations, **deduped to one
per ticker per WIB day** (the day's last non-empty rec; migration
`025_accuracy_daily_dedupe` — cycle-level scoring overweighted the
most-analyzed tickers). For each it finds `price_at_rec` (latest snapshot
at/before the analysis) and `price_after` (earliest snapshot ≥ analysis +
`days_after`), plus the same two points for `^JKSE`, then computes
`actual_change_pct`, `benchmark_change_pct`, a `rec_class`, and `correct`:

| `rec_class` | Keywords | Correct when |
|---|---|---|
| `BUY-ISH` | BUY, BELI, BUY SEKARANG, AVERAGE DOWN | price went up |
| `SELL-ISH` | CUT LOSS, JUAL, TRIM, TAKE PROFIT | price went down |
| `HOLD-ISH` | HOLD, TUNGGU, MONITOR | tracked IHSG within `hold_band_pct` |

`^JKSE` is excluded from its own scoring.

## Why HOLD-ish is benchmark-relative

Until migration `037_accuracy_benchmark_relative`, HOLD-ish scored correct
whenever `|move| < 5%`. IDX large-cap 3-day volatility sits around 2-3%, so
that band was close to a free pass: in the 2026-08-29 → 09-05 sample, 86% of
scored recommendations were HOLD-ish and scored 92%, while the six actionable
calls in the same sample scored 33%. The blended 84% measured how quiet the
market was, not whether the desk was right. It also ran backwards for held
positions — a HOLD on PTBA that then rose 11% was marked *wrong* for being
right about direction.

A HOLD is a decision to do nothing, so the honest question is whether doing
nothing cost anything relative to the market. BUY-ish and SELL-ish stay
absolute: those transact, and their alternative is cash, not the index.

When no `^JKSE` snapshot brackets the window, `benchmark_change_pct` is null
and HOLD-ish falls back to the old absolute `|move| < 5%` rule, so early
history and IHSG gaps still score instead of going null.

## Related

- Reads [llm_analyses](../tables/llm-analyses.md) and
  [stock_snapshots](../tables/stock-snapshots.md).
- Called via `getRecommendationAccuracy` (`app/src/db/db.ts`) from the
  [week-review](../pipelines/week-review.md) pipeline, which renders both the
  blended figure and a per-`rec_class` breakdown, and read directly by the web
  ticker detail page.
- Sample size is shaped by the re-analysis gate (`shouldReanalyze` in
  `app/src/telegram/alerts.ts`): an unchanged call on a flat ticker is no
  longer re-written each day, so expect fewer but more meaningful scored rows.
