---
type: table
title: stock_dividends
description: Dividend income received per stock ticker.
resource: supabase/migrations/016_stock_dividends.sql
tags: [supabase, portfolio, income]
generated:
  by: human:marvellooni
  at: 2026-07-08T00:00:00Z
status: stable
---

# stock_dividends

One row per dividend payment. Columns: `ticker`, `amount` (total IDR
received, net), `per_share` (optional IDR/share), `paid_at` (date), `notes`,
`created_at`. No `active` flag — income rows are not soft-deleted the way
purchase/position rows are.

Managed **web-only**; authenticated read/write under RLS, backend bypasses
RLS via the service role.

## Related

- Income, not capital: summed into the web dashboard's Income figure
  (dividends + [fund_distributions](fund-distributions.md) + bond coupons),
  kept separate from Capital (unrealized + realized P&L).
