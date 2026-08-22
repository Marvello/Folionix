---
type: metric
title: unrealized P&L
description: Mark-to-market profit/loss of a position — per-share, percent, and total (× lots × 100 shares).
resource: lib/format.ts
tags: [pnl, portfolio, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# unrealized P&L

`utils.calc_pnl(current_price, avg_price, lots)` returns:

- `pnl` — per-share gain: `current_price - avg_price`
- `pnl_pct` — `(current_price / avg_price - 1) × 100`
- `total_pnl` — `pnl × lots × 100` (1 lot = 100 shares)

Persisted as `unrealized_pnl`, `unrealized_pnl_pct`, `total_pnl` on each
snapshot. On cache hits, `market.fetch_stock` recomputes P&L from the live
position so edits take effect without a cache bust.

## Related

- Inputs: `current_price` from [yahoo-finance2 market data](../datasets/yahoo-finance2-market-data.md),
  `avg_price`/`lots` from [portfolio_positions](../tables/portfolio-positions.md).
- Stored on [stock_snapshots](../tables/stock-snapshots.md).
- Bucketed into [position status](position-status.md).
- Summed for the portfolio total in [portfolio-analysis](../pipelines/portfolio-analysis.md).
- Summed with [realized P&L](realized-pnl.md) into the web dashboard's
  Capital figure (Capital-vs-Income split).
