---
type: table
title: fund_snapshots
description: Per-fund NAV-per-unit history, one row per fund per NAV date.
resource: supabase/migrations/005_funds_bonds.sql
tags: [supabase, funds, snapshot]
generated:
  by: human:marvellooni
  at: 2026-06-23T00:00:00Z
status: stable
---

# fund_snapshots

Append-only log of NAV-per-unit fetches, one row per `(fund_code, nav_at)` —
a unique index on that pair makes inserts idempotent, so re-running the
refresh sweep the same day is a no-op even though it re-fetches the whole
catalog. Columns: `fund_code` (FK to [fund_catalog](fund-catalog.md).`code`),
`nav` (NAV per unit, 6dp precision preserved from the provider), `currency`,
`nav_at` (the provider's own NAV date, not the fetch time), `fetched_at`.

Written by [refresh_fund_navs](../pipelines/fund-navs.md) via
`db.save_fund_snapshot`; the freshest row per fund is exposed through the
[latest_fund_navs](../datasets/latest-fund-navs.md) view. Index on
`(fund_code, fetched_at desc)`.

## Related

- [fund_purchases](fund-purchases.md) holdings are valued against this
  table's freshest NAV per fund (via `latest_fund_navs`), never the buy NAV.
- Produced by the [fund-navs](../pipelines/fund-navs.md) pipeline
  (`refreshFundNavs` in `app/src/services/funds.ts`).
