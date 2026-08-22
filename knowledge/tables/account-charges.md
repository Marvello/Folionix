---
type: table
title: account_charges
description: Account-level fees not attributable to any single holding — reduce Total Return, not capital or per-asset income.
resource: supabase/migrations/019_account_charges.sql
tags: [supabase, fees, total-return]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# account_charges

Account-wide costs that belong to no single position — broker data-feed
subscription, monthly stamp duty (meterai), late fees, etc. One row per
charge. Columns: `charged_at`, `type` (`DATA_FEE` | `METERAI` | `LATE_FEE` |
`OTHER`, checked), `amount` (IDR), `notes`, `created_at`. Index
`ix_account_charges_date` on `charged_at desc`. RLS: authenticated
read/write, service role bypasses.

These feed the dashboard's **Total Return = Capital + Income − Fees** line:
distinct from Capital (unrealized + realized P&L) and Income (dividends +
distributions + coupons) — a third, subtractive term. Web-only.

## Related

- Complements per-trade fees, which are folded into stock cost basis instead
  (see [realized P&L](../metrics/realized-pnl.md), migration 020) —
  `account_charges` is for costs with no owning trade.
- Not consumed by any backend pipeline; read directly by the web dashboard.
