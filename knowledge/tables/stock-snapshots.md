---
type: table
title: stock_snapshots
description: Per-ticker market snapshot — price, day change, 52-week range, fundamentals, and position P&L at a point in time.
resource: supabase/schema.sql
tags: [supabase, market-data, snapshot, idx]
generated:
  by: human:marvellooni
  at: 2026-06-22T00:00:00Z
status: stable
---

# stock_snapshots

Append-only log of market snapshots. One row per fetch per ticker (`fetched_at`,
`ticker`, `symbol`). Written by [fetch_stock](../datasets/yahoo-finance2-market-data.md)
via `db.save_snapshot`; the freshest row per ticker is exposed through the
[latest_snapshots](../datasets/latest-snapshots.md) view.

## Columns of note

- Price: `current_price`, `prev_close`, `day_change`, `day_change_pct`,
  `high_52w`, `low_52w`, `volume`.
- Position: `avg_price`, `lots`, `unrealized_pnl`, `unrealized_pnl_pct`,
  `total_pnl`, `position_status`, `dist_from_high`, `dist_from_low`.
- Fundamentals: `pe`, `pb`, `roe_pct`, `div_yield_pct`, `profit_margin_pct`,
  `debt_to_equity`, `beta`, `eps`, `market_cap_raw`, `revenue_raw`.

Indexes on `ticker` and `fetched_at`.

## Derived metrics

- [Unrealized P&L](../metrics/unrealized-pnl.md)
- [Position status](../metrics/position-status.md)
- [Day change %](../metrics/day-change-pct.md)
- [Distance from 52-week range](../metrics/distance-from-52w.md)
- [Volume ratio](../metrics/volume-ratio.md) (vs a prior-day baseline snapshot)

## Consumers

- The web dashboard reads the **raw history** here directly (not the
  [latest_snapshots](../datasets/latest-snapshots.md) view) to draw trend
  sparklines: the ticker-detail page pulls the last ~90 rows for a full
  sparkline, and the dashboard/portfolio/watchlist tables pull the last ~40
  rows per ticker (`web/lib/history.ts`) for inline row sparklines, ordered by
  `fetched_at`. Sparkline color follows the gain/loss market semantics — see
  the brand guide (`knowledge/design.md`).

## Related

- [llm_analyses](llm-analyses.md) references a snapshot via `snapshot_id`.
- Produced by the [portfolio-analysis](../pipelines/portfolio-analysis.md) and
  [price-refresh](../pipelines/price-refresh.md) pipelines.
