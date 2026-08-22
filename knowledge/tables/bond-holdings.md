---
type: table
title: bond_holdings
description: Indonesian retail (SR/ORI/SBR/ST) and corporate (CORP) bond holdings, valued at par.
resource: supabase/migrations/005_funds_bonds.sql
tags: [supabase, bonds, source-of-truth]
generated:
  by: human:marvellooni
  at: 2026-06-23T00:00:00Z
status: stable
---

# bond_holdings

The canonical record of bond positions owned, valued at par (principal) —
there is no market price feed for retail Indonesian bonds, so this table
is both the source of truth and the valuation input (unlike gold/funds,
there is no companion price-snapshot table or provider). Columns:
`series_type` (`SR` / `ORI` / `SBR` / `ST` / `CORP`, checked), `series_code`
(e.g. `ORI025`, `SR021`, or a corporate bond name/ISIN), `platform` (where
bought), `principal` (IDR nominal held — the par value), `coupon_rate`
(annual %, nullable), `maturity_date`, `purchased_at`, `active`, `notes`,
`updated_at`. Removal is a soft delete (`active = false`).

Managed **web-only** via the `/bonds` page (modal add/edit/remove);
authenticated read/write under RLS, backend bypasses RLS via the service
role. The Telegram bot's `/blist` only reads — there is no `/badd`/`/bremove`.

## Related

- Read by `app.bonds.holdings.list_holdings`/`summary`, which value each
  row at its own `principal` and compute `days_to_maturity` from
  `maturity_date` (no external pricing pipeline).
