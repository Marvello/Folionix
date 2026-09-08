---
type: pipeline
title: fundamentals refresh
description: Daily sweep fetching key statistics, quarterly financials and split events for held and watchlist tickers.
resource: app/src/services/fundamentals.ts
tags: [postgres, pipeline, fundamentals, yahoo, daily]
generated:
  by: human:marvellooni
  at: 2026-09-07T00:00:00Z
status: stable
---

# fundamentals refresh

`refreshFundamentals(tickers?)` in `app/src/services/fundamentals.ts`. Sweeps the
union of held positions and watchlist entries, or an explicit ticker list, and
writes three tables.

## Flow

1. Union `loadPortfolio()` and `getWatchlist()`, normalize every ticker.
2. Fan out through `utils/mapPool` under `PROVIDER_CONCURRENCY` (default 4), so
   a large portfolio cannot burst yahoo and trip its rate limits.
3. Per ticker, in parallel: `fetchKeyStats`, `fetchFinancials`, `fetchSplits`.
4. Write [stock_key_stats](../tables/stock-key-stats.md),
   [stock_financials](../tables/stock-financials.md) and
   [corporate_actions](../tables/corporate-actions.md) with `type = 'SPLIT'`.
5. Return one `RefreshResult` per ticker.

## Failure contract

Per-ticker failures are recorded in that ticker's `error` and skipped. One bad
ticker never aborts the sweep, mirroring `runPriceRefresh`.

Note that the three fetchers each swallow their own errors and return
`null`/`[]`, so in practice a yahoo outage looks like absent data rather than a
recorded error. Surfacing that distinction to the user is unfinished work.

## Schedule

Daily at `FUNDAMENTALS_HOUR_WIB`, default 18:00 WIB, by the graph runner. That
is after the 17:00 fund NAV sweep so the two daily jobs do not land on one
cycle. The latch is in-memory, so a process restart later the same day re-runs
the sweep, which matches every other daily job in the runner.

Manual: `npm run fundamentals`, optionally with tickers.

## Related

- Reads from yahoo-finance2, the same provider as
  [stock_snapshots](../tables/stock-snapshots.md), but on a daily rather than
  five-minute clock.
