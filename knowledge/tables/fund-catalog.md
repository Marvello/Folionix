---
type: table
title: fund_catalog
description: Mutual-fund universe (code, name, type, manager) for the web add-form autocomplete; upserted by the NAV refresh sweep.
resource: supabase/migrations/005_funds_bonds.sql
tags: [supabase, funds, source-of-truth]
generated:
  by: human:marvellooni
  at: 2026-06-23T00:00:00Z
status: stable
---

# fund_catalog

The active-fund universe, keyed by `code` (the provider's fund code, e.g. a
Cermati product code). One row per fund, upserted (not appended) by each
NAV refresh sweep — this is a catalog, not a history. Columns: `name`,
`fund_type` (`SAHAM` / `PASAR_UANG` / `PENDAPATAN_TETAP` / `CAMPURAN`),
`category` (`KONVENSIONAL` / `SYARIAH`), `investment_manager`, `currency`
(`IDR` / `USD`), `active`, `updated_at`.

Exists purely to power the web `/funds` add-form's autocomplete search —
the bot never reads it directly (funds are added web-only).

## Related

- Written by `app.db.upsert_fund_catalog`, called from
  [fund-navs](../pipelines/fund-navs.md) (`refresh_fund_navs`).
- Each `code` here is also the foreign key used by
  [fund_purchases](fund-purchases.md) and [fund_snapshots](fund-snapshots.md).
