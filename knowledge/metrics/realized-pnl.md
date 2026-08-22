---
type: metric
title: realized P&L
description: Locked-in gain/loss from closed lots — stocks, gold, and funds — computed weighted-average on SELL.
resource: supabase/migrations/020_fold_trade_fees.sql
tags: [pnl, portfolio, metric, income]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# realized P&L

Gain/loss locked in when a SELL closes part or all of a position, computed
weighted-average against the running avg cost at the time of sale:
`(sell_price − avg_cost) × qty_sold` (stocks: `× 100` for lots → shares).
Three independent implementations, one formula:

- **Stocks**: `recompute_stock_position` (Postgres trigger on
  [stock_transactions](../tables/stock-transactions.md)) accumulates it into
  `portfolio_positions.realized_pnl`. Since **migration 020** trade fees fold
  into cost basis: a BUY adds its `fee` to the acquired shares' cost (raising
  `avg_price`), and a SELL subtracts its `fee` from realized P&L —
  `(sell_price − avg_cost) × qty_sold × 100 − fee` — so position P&L matches
  the broker's net amount. Gold and funds carry no per-fill fee, so their
  realized P&L is fee-free.
- **Gold**: `listGoldHoldings`/`summary` compute it in TypeScript from
  [gold_purchases](../tables/gold-purchases.md)`.side = 'SELL'` rows.
- **Funds**: the [fund_product_summary](../datasets/fund-product-summary.md)
  view computes it in SQL from [fund_purchases](../tables/fund-purchases.md)`.side = 'SELL'` rows.

Bonds have no realized P&L concept — no sell path, valued at par to maturity.

## Related

- Summed with [unrealized P&L](unrealized-pnl.md) into the web dashboard's
  Capital figure, kept separate from Income
  ([stock_dividends](../tables/stock-dividends.md),
  [fund_distributions](../tables/fund-distributions.md), bond coupons) in
  the Capital-vs-Income split.
