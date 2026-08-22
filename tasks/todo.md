# Fix: signal storm starves scheduled analysis (RANS/PRDL +24% day)

## Problem
- MAJOR signal (day move ≥5%) re-fires every 5-min cycle all day → only spiking tickers analyzed (~70 LLM calls on RANS/PRDL), scheduled watchlist runs never fire, `SIGNAL_COOLDOWN_MIN` documented but unimplemented.
- Watchlist tickers never scanned for signals (ARTO +7.76% missed).
- `decideDepth` result discarded — `runPortfolioPipeline` hardcodes FULL.

## Plan
- [x] `signals.ts`: pure `filterCooledSignals(signals, cooldowns, nowMs)` using `SIGNAL_COOLDOWN_MIN` (default 60)
- [x] `state.ts`: add `signal_cooldowns: Record<string, string>` to OrchestratorState
- [x] `orchestrator.ts`: routeNode filters cooled signals; MAJOR route stamps cooldowns; when all MAJOR cooled, fall through to session/scheduled checks
- [x] `orchestrator.ts`: checkSignalsNode scans watchlist tickers too
- [x] `portfolio.ts`: `runPortfolioPipeline(tickers?, depth = 'FULL')`; explicit tickers not in portfolio resolve from watchlist (lots 0)
- [x] `analysis.ts`: pass `state.depth` through
- [x] tests: cooldown filter unit tests in `signals.test.ts`
- [x] `npm test` + `npm run typecheck`

## Review
- typecheck clean; 181/181 tests pass (4 new cooldown tests).
- Behavior change: MAJOR signal now analyzes once per `SIGNAL_COOLDOWN_MIN` (default 60) per ticker; scheduled watchlist cadence resumes between signal runs; watchlist tickers now signal-scanned; `decideDepth` result actually reaches the pipeline (MAJOR → DEEP).
- runAnalysisNode tier now derived from `pending_batch` (raw signals may hold cooled MAJORs during scheduled runs).
- Deploy note: graph runner runs in Docker (`folionix-graph`) — needs image rebuild/pull to take effect. Consider setting `SIGNAL_COOLDOWN_MIN` in tower `.env`.

# Follow-up: daily baseline + spike-only alerts (2026-07-15)

## Requirement
Every held position analyzed ≥1×/trading day; Telegram alerts only for spike-triggered runs.

## Done
- [x] `AlertMode = 'spike' | 'dedup' | 'silent'` on `analyzeOneTicker`/`runPortfolioPipeline`/`runWatchlistPipeline`
  - spike: always send (signal route) • dedup: rec-change/first-of-day (manual CLI + bot, unchanged) • silent: never send
- [x] Orchestrator signal route → 'spike'; scheduled/session-boundary watchlist runs → 'silent'
- [x] Runner: daily silent FULL portfolio baseline on first active-session cycle (~09:00 WIB, weekends skipped via detectSession)
- [x] typecheck + 181 tests pass

## Review
- Spike alerts now fire on every signal-route analysis (max 1/ticker/hour via cooldown) — needed because silent baseline consumes evaluateAlert's new-day token, which would have muted afternoon spikes under dedup.
