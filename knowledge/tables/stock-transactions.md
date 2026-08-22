---
type: table
title: stock_transactions
description: Append-only ledger of stock BUY/SELL fills — now the source of truth for stock positions.
resource: supabase/migrations/015_stock_transactions.sql
tags: [supabase, portfolio, source-of-truth]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# stock_transactions

The canonical record of what happened: one row per fill. Columns: `ticker`,
`side` (`BUY`/`SELL`, checked), `lots` (1 lot = 100 shares, `> 0`), `price`
(executed IDR/share), `fee` (broker fee IDR, default 0), `txn_at`, `notes`,
`created_at`. Append-only in normal use — corrections are new offsetting
rows, not edits (though the trigger recomputes correctly either way).

Managed **web-only**; authenticated read/write under RLS, backend bypasses
RLS via the service role.

## Related

- Every insert/update/delete fires `trg_stock_txn_recompute`
  (`recompute_stock_position(ticker)`), which folds the ticker's full
  transaction history (oldest first, weighted-average) into
  [portfolio_positions](portfolio-positions.md) — `avg_price`, `lots`, and
  `realized_pnl`. `portfolio_positions` is now a **derived cache**, not the
  source of truth.
- Trade fees fold into cost basis (migration 020, superseding 015's fee-free
  function): a BUY adds `fee` to the acquired shares' cost (raising
  `avg_price`), a SELL realizes `(price − avg_price) × lots × 100 − fee` into
  `portfolio_positions.realized_pnl` — matching the broker's net amount. Feeds
  Capital in the web dashboard's Capital-vs-Income split alongside
  [unrealized P&L](../metrics/unrealized-pnl.md).
- Migration 015 backfilled one opening `BUY` transaction per pre-existing
  active `portfolio_positions` row so history is never empty.
