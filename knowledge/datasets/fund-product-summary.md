---
type: dataset
title: fund_product_summary
description: Per-fund aggregate of fund_purchases — net units, avg buy NAV, current value, unrealized and realized P&L.
resource: supabase/migrations/017_gold_fund_side.sql
tags: [supabase, view, funds]
generated:
  by: human:marvellooni
  at: 2026-07-08T00:00:00Z
status: stable
---

# fund_product_summary

View aggregating [fund_purchases](../tables/fund-purchases.md) per
`fund_code`. Nets `BUY` minus `SELL` rows (weighted-average buy NAV) rather
than summing all rows: `total_units` = buy units − sell units,
`avg_buy_nav`/`total_cost` computed from `BUY` rows only, `current_value`
and `pnl` (unrealized) computed on the net remaining units at the fund's
`latest_nav`. Adds `realized_pnl` = sell proceeds − (avg buy NAV × units
sold), accumulated across all `SELL` rows.

## Related

- Source: [fund_purchases](../tables/fund-purchases.md) `side` column
  (added migration 017) drives the buy/sell split.
- `realized_pnl` feeds the web dashboard's Capital figure alongside
  unrealized P&L and [portfolio_positions](../tables/portfolio-positions.md)`.realized_pnl`.
- Superseded an earlier version of the view (migration 013) that summed all
  `fund_purchases` rows without a buy/sell distinction.
