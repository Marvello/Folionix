---
type: table
title: portfolio_positions
description: Derived cache of owned IDX positions — ticker, average buy price, lots, realized P&L, active flag, and notes, recomputed from stock_transactions.
resource: supabase/schema.sql
tags: [supabase, portfolio, derived-cache]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# portfolio_positions

One row per `ticker` (unique constraint `uq_portfolio_ticker`). Columns:
`avg_price`, `lots` (1 lot = 100 shares), `realized_pnl` (added in migration
015), `active`, `notes`, `updated_at`. Removal is a soft delete
(`active = false`).

**No longer the source of truth** — [stock_transactions](stock-transactions.md)
is. `avg_price`, `lots`, and `realized_pnl` are recomputed wholesale by the
`trg_stock_txn_recompute` trigger (`recompute_stock_position`) on every
`stock_transactions` write; direct edits to those three columns are
overwritten on the next transaction. Since migration 020, `avg_price` is
**fee-inclusive** — each BUY's trade fee folds into the cost basis, and a
SELL's fee reduces `realized_pnl`. `notes` is the one column still
hand-edited directly and preserved across recomputes.

Managed via the Telegram bot (`/add`, `/update`, `/remove` — legacy path,
still writes `portfolio_positions` directly for now) and the web UI (writes
through `stock_transactions`); authenticated read/write under RLS, backend
bypasses RLS via the service role.

## Related

- Read into the in-memory [active-portfolio](../datasets/active-portfolio.md)
  dataset by `db.load_portfolio`.
- `avg_price` and `lots` drive the [unrealized P&L](../metrics/unrealized-pnl.md)
  and [position status](../metrics/position-status.md) metrics on each snapshot.
- `realized_pnl` (from closed lots) plus unrealized P&L feed the web
  dashboard's Capital figure in the Capital-vs-Income split.
- Drives target selection in [portfolio-analysis](../pipelines/portfolio-analysis.md)
  and [price-refresh](../pipelines/price-refresh.md).
- Recomputed by [stock_transactions](stock-transactions.md)'s trigger, not
  written directly by the web stock-transaction flow.
