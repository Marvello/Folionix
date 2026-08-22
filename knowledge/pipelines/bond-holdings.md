---
type: pipeline
title: bond holdings
description: Bond holdings valuation at par (principal); no price provider or refresh job.
resource: app/src/services/bonds.ts
tags: [pipeline, bonds, valuation]
generated:
  by: human:marvellooni
  at: 2026-06-23T00:00:00Z
status: stable
---

# bond holdings

Unlike gold and funds, bonds have no external price feed — Indonesian
retail bond series (SR/ORI/SBR/ST) and corporate bonds (CORP) are not
continuously quoted, so there is no provider, no snapshot table, and no
refresh CLI. `app.bonds.holdings` (read-only, not a CLI) reads
[bond_holdings](../tables/bond-holdings.md) directly and values each row at
its own `principal` (par value) — the field the user entered at purchase
time is also the valuation. It also computes `days_to_maturity` from
`maturity_date` and a status emoji (🟢 healthy, 🟡 maturing within 90 days,
🔴 matured, ⚪ no maturity date).

Bonds have no *price* refresh, but the
[orchestrator runner](orchestrator.md#product-refresh-schedule) does run one
scheduled bond job daily at ≥ 08:00 WIB: `syncBondCouponSchedules` (KSEI scrape
for SR/ORI/SBR/ST coupon dates) followed by `sendCouponReminders` (H-1 Telegram
alert before each coupon).

Used by both the Telegram bot (`/blist`, read-only) and the web `/bonds`
page (full CRUD — add/edit/remove a holding via modal).

## Related

- No LLM/news involvement, and no companion pricing pipeline — contrast
  with [gold holdings](gold-holdings.md) and [fund NAVs](fund-navs.md),
  which both refresh a price/NAV snapshot table from an external provider.
