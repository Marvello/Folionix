---
type: table
title: fund_distributions
description: Cash distributions received from distributing mutual funds.
resource: supabase/migrations/018_fund_distributions.sql
tags: [supabase, funds, income]
generated:
  by: human:marvellooni
  at: 2026-07-08T00:00:00Z
status: stable
---

# fund_distributions

One row per distribution payment. Columns: `fund_code` (matches
[fund_catalog](fund-catalog.md).`code`, not FK-enforced), `amount` (total IDR
received), `paid_at` (date), `notes`, `created_at`. No `active` flag — income
rows are not soft-deleted the way purchase/position rows are.

Managed **web-only**; authenticated read/write under RLS, backend bypasses
RLS via the service role.

## Related

- Income, not capital: summed into the web dashboard's Income figure
  (fund distributions + [stock_dividends](stock-dividends.md) + bond
  coupons), kept separate from Capital (unrealized + realized P&L).
- Mirrors [stock_dividends](stock-dividends.md) for the fund domain.
