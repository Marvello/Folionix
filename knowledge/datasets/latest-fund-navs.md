---
type: dataset
title: latest_fund_navs
description: View exposing the single most-recent fund_snapshots row per fund.
resource: supabase/migrations/005_funds_bonds.sql
tags: [supabase, view, funds]
generated:
  by: human:marvellooni
  at: 2026-06-23T00:00:00Z
status: stable
---

# latest_fund_navs

`select distinct on (fund_code) * from fund_snapshots order by fund_code, id desc`.
Gives the web `/funds` page (and `app.funds.holdings`) one current NAV row
per fund without a per-query subselect.

## Related

- Derived from the [fund_snapshots](../tables/fund-snapshots.md) table.
- Read by `db.get_latest_fund_nav` (single fund) and `db.get_latest_fund_navs`
  (all funds); used by `app.funds.holdings` to value
  [fund_purchases](../tables/fund-purchases.md) at the fund's latest NAV
  per unit.
