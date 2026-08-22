---
type: dataset
title: yahoo-finance2 market data
description: Primary external market feed — price, day change, 52-week range, volume, and fundamentals per IDX ticker via yahoo-finance2.
resource: app/src/providers/market.ts
tags: [yahoo-finance2, market-data, external, idx]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# yahoo-finance2 market data

`fetchStock` in `app/src/providers/market.ts` is the primary source feed. IDX tickers auto-append `.JK`.
It calls `yahooFinance.quoteSummary` for fundamentals and `yahooFinance.quote` for price data,
with snapshot caching honored via `CACHE_MINUTES`.

When yahoo-finance2 returns no usable price, it falls back to the
[Finnhub quotes](finnhub-quotes.md) feed. With no price from either provider it
returns `{ error: ... }` rather than persisting a misleading zero-price row.

The normalized dict is persisted to [stock_snapshots](../tables/stock-snapshots.md)
and carries the [P&L](../metrics/unrealized-pnl.md),
[position status](../metrics/position-status.md),
[day change %](../metrics/day-change-pct.md), and
[distance-from-52w](../metrics/distance-from-52w.md) metrics.

## Related

- Consumed by every analysis pipeline:
  [portfolio-analysis](../pipelines/portfolio-analysis.md),
  [watchlist-analysis](../pipelines/watchlist-analysis.md),
  [price-refresh](../pipelines/price-refresh.md),
  [analysis-graph](../pipelines/analysis-graph.md).
