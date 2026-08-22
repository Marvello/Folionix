---
type: metric
title: volume ratio
description: Current cumulative volume divided by a prior-trading-day baseline, used to detect volume spikes.
resource: app/src/graph/signals.ts
tags: [volume, signal, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# volume ratio

In `signals.detect_signals_for_ticker`:
`volume_ratio = current_volume / prev_snapshot.volume`, where the baseline is
the last snapshot of a previous WIB day (`db.get_snapshot_before` at the WIB
midnight cutoff). This compares full-day cumulative volume against a full-day
reference rather than a minutes-old partial. Defaults to `0.0` with no baseline.

## Related

- Inputs are `volume` on [stock_snapshots](../tables/stock-snapshots.md).
- Classified into the [market signal](market-signal.md) volume-spike tier.
