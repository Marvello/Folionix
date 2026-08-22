---
type: metric
title: market signal
description: Classification of a ticker's day move and volume ratio into a signal type and MINOR/MAJOR tier.
resource: app/src/graph/signals.ts
tags: [signal, tier, orchestrator, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# market signal

`signals.classify_signal` maps [day change %](day-change-pct.md) and
[volume ratio](volume-ratio.md) to a signal. Default thresholds (env-tunable):

- Price: MINOR ≥ `SIGNAL_PRICE_MINOR` (3.0%), MAJOR ≥ `SIGNAL_PRICE_MAJOR` (5.0%)
- Volume: MINOR > `SIGNAL_VOLUME_MINOR` (1.5×), MAJOR ≥ `SIGNAL_VOLUME_MAJOR` (3.0×)

Tiers: price + volume both hit → COMBINED/MAJOR; else major price → PRICE_MOVE/MAJOR;
major volume → VOLUME_SPIKE/MAJOR; minor price → PRICE_MOVE/MINOR; minor volume →
VOLUME_SPIKE/MINOR; else none.

## Related

- Drives routing (skip / batch / immediate) and analysis depth in the
  [orchestrator](../pipelines/orchestrator.md).
