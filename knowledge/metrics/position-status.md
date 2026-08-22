---
type: metric
title: position status
description: Emoji-tiered bucket of a position's P&L percent, from BIG PROFIT to DEEP LOSS.
resource: app/src/providers/market.ts
tags: [pnl, status, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# position status

Buckets `pnl_pct` into a labeled tier in `market.fetch_stock`:

| Condition | Status |
|-----------|--------|
| ≥ 10% | 🟢 BIG PROFIT |
| ≥ 2% | 🟢 PROFIT |
| ≥ -2% | ⚪ BREAKEVEN |
| ≥ -10% | 🟡 SMALL LOSS |
| ≥ -20% | 🔴 LOSS |
| < -20% | 🔴 DEEP LOSS |

Stored as `position_status` on the snapshot; `N/A` when no `avg_price`.

## Related

- Derived from [unrealized P&L](unrealized-pnl.md).
- Stored on [stock_snapshots](../tables/stock-snapshots.md).
