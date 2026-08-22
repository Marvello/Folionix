---
type: dataset
title: active portfolio
description: In-memory map of active positions {TICKER: {avg_price, lots, notes, active}} loaded from portfolio_positions.
resource: app/src/db/db.ts
tags: [portfolio, derived]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# active portfolio

`db.load_portfolio` returns active positions as `{TICKER: {avg_price, lots,
notes, active}}`. This is the in-memory dataset the pipelines iterate over;
there is no `portfolio.json` — Supabase is the source of truth.

## Related

- Backed by the [portfolio_positions](../tables/portfolio-positions.md) table
  (active rows only).
- Iterated by [portfolio-analysis](../pipelines/portfolio-analysis.md),
  [price-refresh](../pipelines/price-refresh.md), and the
  [orchestrator](../pipelines/orchestrator.md) signal scan.
