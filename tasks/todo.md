# Follow-ups after the 2026-10-06 review deploy (branch `fix/review-followups`)

Source: `tasks/review-2026-10-06.md` ([~]/[-] items) + findings during the deploy.

## A. Remaining review items — in progress (approved)
- [x] A1 June-2026 `div_yield_pct` rows 100× too large (1,242 rows, legacy writer) → migration
- [x] A2 USD reporters (AADI/ADRO/BSSR…) get ~0% yield: yahoo divides a USD dividend by an IDR price → fx-correct like P/B
- [x] A3 P2-DB4 money/quantity columns → `numeric` (drop/recreate dependent views) — own migration, tested on a prod-copy restore
- [x] A4 P3-8 delete `baselineGaps` + pre-baseline shims once the live ledger is confirmed complete (read prod `schema_migrations`)
- [x] A5 P2-DB10 checksum applied migration files (detect edits to already-applied SQL)
- [x] A6 P2-DB12 case-insensitive unique email (check prod for collisions first); drop unused NextAuth tables (`accounts`, `sessions`, `verification_token`) if empty
- [x] A7 P2-DB7 bulk-import path: recompute once per statement instead of per row
- [x] A8 P2-DB8 batch remaining per-row writers (financials, corporate actions, news cache, coupon schedule, fund holdings)
- [x] A9 P2-AI14 week-review prompt size vs Ollama context (silent truncation) — measure, then trim/summarize inputs
- [x] A10 P2-UX18 secondary/inline buttons to spec size; P2-UX20 remaining raw `<label>`s
- [x] A11 pre-existing eslint errors (CorporateActions, FinancialsTable, KeyStats)
- [x] A12 P3-6 compose log limits + container healthchecks; k8s liveness/readiness probes (none today) using `/api/health` for web
- [x] A13 sync the new pool timeouts/error handler into Vitalix's copy (`common-tech/tech-standard/postgres-client.md` already updated) — separate repo, separate PR

### A — resolution notes
- A1 migration 045 rescales the 1,242 June rows (window + >20 guard; verified on a prod-dump restore: max now 14.88%).
- A2 `correctDividendYield` (trailing rate × fx ÷ IDR price) for USD reporters — AADI ≈ 4.4% instead of ~0. Historic ~0 rows for USD reporters left as-is.
- A3 migration 046: 16 ledger columns → `numeric`, `fund_product_summary` recreated, recompute uses numeric; numeric parser in both pools. Prod-copy diff of every position / fund summary / ledger total: identical. 0.1+0.2−0.3 units = exactly 0.
- A4 `baselineGaps` removed, baseline → 039, files 001–039 deleted (prod ledger confirmed 001–039 complete); fresh bootstrap from schema.sql + migrate verified.
- A5 sha256 per applied file (runner adds/backfills `schema_migrations.checksum`); `--check` exits 1 and startup warns when an applied file was edited.
- A6 migration 047: `uq_users_email_lower`; unused `accounts`/`sessions`/`verification_token` dropped (empty, adapter never installed).
- A7 migration 048: statement-level recompute triggers (2,000-row insert 16 ms; insert/update/delete parity verified; positions unchanged on prod copy).
- A8 news cache + fund holdings batched. **Also fixed:** fire-and-forget `saveNewsArticles`/`saveSentiment` rejections were unhandled (Node 24 would crash the runner). Financials/corporate actions/coupon schedule left per-row (≤20 rows/call).
- A9 measured: weekly-review prompt ≈3.5–4.5k tokens; prod uses the omniroute gateway (large context) so no truncation; Ollama users told to set num_ctx ≥ 16k in `.env.example`.
- A10/A11 (frontend agent, verified): shared `SecondaryButton`/`IconButton` (40px / 32px, `rounded-sm`), Bonds pager → shared `Pager`, `<Field inline>` for ScheduleLogForm rows and login; eslint 0 errors (CorporateActions component hoisted, `isStale()` helper instead of `Date.now()` in render). Visible changes: Remove buttons get the standard outline; login labels `text-xs`. Also: `tone()`/`dirGlyph()` treat sub-rupiah residue as flat (Funds 'Realized ▲ IDR 0' → '◆').
- A12 compose: bounded json-file logs, heartbeat healthchecks (runner/worker), web healthcheck; k8s manifest: liveness (heartbeat exec) for graph/worker, readiness+liveness `/api/health` for web — server dry-run OK, **apply with the follow-up deploy**.
- A13 Vitalix: pool timeouts + migrator opt-out on local branch `chore/pg-pool-timeouts` (103/103 tests incl. live DB) — not pushed.

## B. Proposed improvements — NOT started, pick what you want
Data & analysis
- [ ] B1 **Sector peers**: `stock_peers` table (editable; seeded proposal for the 19 tracked tickers) → extend the 18:00 fundamentals sweep to peers → peer-median P/E, P/B, ROE, margin, yield in analysis + persona prompts → restore DEEP "Sector Comparison", bound by the grounding rules
- [ ] B2 Fetch sector/industry (yahoo `assetProfile`) — the `sector` column has been empty in every snapshot; also enables sector allocation on the dashboard
- [ ] B3 Recommendation accuracy loop: show hit-rate per recommendation type / per persona on /reviews, and feed it back to the consensus weights (personas that are reliably wrong count less)
- [ ] B4 Prompt regression set: a handful of frozen snapshot fixtures + expected REKOMENDASI ranges, run against the real model on demand (catches prompt/model drift before prod)
- [ ] B5 Corporate-action awareness in analysis (splits, rights, ex-dates within N days) — data already in `corporate_actions` / `dividend_schedule`

Ops & reliability
- [ ] B6 Pin prod images to `:<sha8>` instead of `:latest` + `imagePullPolicy: Always` — today any pod restart is an unplanned deploy (incl. migrations)
- [ ] B7 Off-host backup copy (dumps live only on turingcm4-1) + a scheduled restore drill into a scratch DB
- [ ] B8 Failure alerting: Telegram ping when the backup CronJob, a scheduled job, or the worker fails / stalls (runner heartbeat row)
- [ ] B9 Longhorn capacity: both RK1 disks fully scheduled (80.0/81.8 GB) — reclaim or retune reserved space before any app needs a new PVC (homelab-wide)

Security
- [ ] B10 Move inline secrets out of `homeserver/k8s/folionix/folionix.yaml` (sealed/SOPS secret); rotate `AIREVIEW_API_TOKEN` (printed in a session on 2026-10-06)
- [ ] B11 Least-privilege DB role for the app/web (today both connect as owner with full DDL)

UX
- [ ] B12 Portfolio-level charts: net-worth history + allocation drift over time (data exists in snapshots / ledgers)

---

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
