---
type: pipeline
title: orchestrator (outer graph)
description: Long-running LangGraph runner that detects the market session, refreshes every product on its own schedule, scans for signals, and routes to the analysis pipeline.
resource: app/src/graph/runner.ts
tags: [pipeline, langgraph, orchestrator, session, signal, schedule]
generated:
  by: human:marvellooni
  at: 2026-07-12T00:00:00Z
status: stable
---

# orchestrator (outer graph)

Replaces cron with a session- and signal-aware loop (`npm run graph`,
`app/src/graph/runner.ts`). Each tick invokes the compiled graph
(`app/src/graph/orchestrator.ts`):
`detect_session → refresh_prices → fetch_news → check_signals → route`.

- `detectSession` (`app/src/graph/session.ts`) maps WIB time to PRE_MARKET, SESSION_1,
  LUNCH, SESSION_2, AFTER_HOURS, or CLOSED (weekends always CLOSED).
- `refresh_prices` runs `runPriceRefresh()` every cycle so dashboard stock prices
  are never null.
- `check_signals` scans the [active portfolio](../datasets/active-portfolio.md),
  honoring per-ticker cooldown, using a prior-WIB-day
  [volume baseline](../metrics/volume-ratio.md).
- `route` → **run_analysis** (any MAJOR [signal](../metrics/market-signal.md),
  or a session-boundary transition, or `GRAPH_ANALYSIS_INTERVAL` elapsed) or
  **skip** (CLOSED, or nothing due). Routed runs invoke the
  [analysis-graph](analysis-graph.md) with a depth from `decide_depth`.

## Product refresh schedule

The runner owns all scheduling. Daily product jobs fire from a `wibHour` gate
(`>=` the target hour, once per WIB day via a `lastXCheckDate` guard, so a cycle
landing after the hour still runs it). The graph cycle handles stocks; the daily
gates handle every other product.

| Product | Cadence | Where | Job(s) |
|---|---|---|---|
| **Stocks** (price) | every cycle | `refresh_prices` node + startup `claimPendingRefresh()` | `runPriceRefresh()` |
| **Stocks** (analysis) | session boundary · every `GRAPH_ANALYSIS_INTERVAL` (30m default) · MAJOR signal → immediate | `route` node | [analysis-graph](analysis-graph.md) |
| **Bonds** | daily ≥ 08:00 WIB | `runBondDailyChecks()` | [`syncBondCouponSchedules`](bond-holdings.md) + `sendCouponReminders` (H-1) |
| **Dividends** | daily ≥ 08:00 WIB | `runDividendDailyChecks()` | [`syncDividendSchedules`](dividend-schedule.md) + `sendDividendReminders` (ex-date H-1 · pay-date) |
| **Forex** | daily ≥ 09:00 WIB | `runForexDailyRefresh()` | `refreshForexRates` |
| **Funds** (NAV) | daily ≥ 17:00 WIB | `runAssetDailyRefresh()` | [`refreshFundNavs`](fund-navs.md) (NAV final after close) |
| **Gold** | daily ≥ 17:00 WIB | `runAssetDailyRefresh()` | [`refreshGoldPrices`](gold-holdings.md) |

Hours are constants in `runner.ts` (`BOND_CHECK_HOUR_WIB=8`,
`FOREX_CHECK_HOUR_WIB=9`, `ASSET_CHECK_HOUR_WIB=17`) — not env-tunable.

### On-demand refresh queue

Each cycle also drains [price_refresh_requests](../tables/price-refresh-requests.md)
via `claimPendingRefresh(kind)`, routed by `kind`:

- `stock` — claimed (price already refreshed by the `refresh_prices` node).
- `gold` — runs `refreshGoldPrices`.
- `fund` — runs `refreshFundNavs` **then** `refreshForexRates` (fund valuation
  needs current FX).

### Loop sleep

Two tiers, env-tunable: **active 300s** (`GRAPH_ACTIVE_INTERVAL=5`, only during
SESSION_1 / SESSION_2) / **idle 1800s** (`GRAPH_IDLE_INTERVAL=30`, every other
session incl. LUNCH, PRE_MARKET, AFTER_HOURS, CLOSED).

`SIGTERM` stops the loop after the current cycle.

## Related

- Schedules the [news-sentiment](news-sentiment.md) and
  [price-refresh](price-refresh.md) steps.
