# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## References
- **knowledge/design.md** : brand guideline for Folionix its identity and styling it need to follow.

## What This Is

Indonesian stock portfolio (IDX) analyzer. Fetches market data via yahoo-finance2, runs LLM analysis via Vercel AI SDK (Ollama or any OpenAI-compatible gateway), sends alerts to Telegram, stores everything in self-hosted Postgres, and provides a Next.js + Tailwind dashboard (`web/`). Node 24 + TypeScript backend (`app/`); Node 24 frontend (`web/`).

## Project Structure

```
app/                        # Node 24 TypeScript backend (ESM, esbuild)
├── package.json            # deps + scripts: bot/graph/worker/prices/portfolio/watchlist/weekreview/migrate/fundamentals/test/typecheck/build
├── tsconfig.json           # bundler resolution, strict, noEmit, includes ../lib/**/*
├── build.mjs               # esbuild bundle (bot, graph/runner, graph/worker, services/{portfolio,fundamentals,weekReview}, db/migrate)
└── src/
    ├── db/db.ts            # Postgres data layer (node-postgres pool over DATABASE_URL)
    ├── db/migrate.ts       # startup migration runner (advisory-locked, refuses to bootstrap)
    ├── providers/
    │   ├── market.ts       # yahoo-finance2 stock fetch (price, fundamentals, P&L)
    │   ├── finnhub.ts      # Finnhub REST fallback provider
    │   ├── cermati.ts      # Gold GraphQL + Fund NAV REST (Cermati)
    │   └── ksei.ts         # Bond coupon schedule (HTML scrape)
    ├── ai/
    │   ├── llm.ts          # Vercel AI SDK primary/fallback chain (Ollama or any OpenAI-compatible gateway)
    │   ├── prompts.ts      # Portfolio-analysis prompt builder
    │   ├── scores.ts       # Deterministic analyst sub-scores (no LLM)
    │   ├── personas.ts     # 12 investor personas (prompt + JSON verdict parsing)
    │   └── consensus.ts    # Persona-vote aggregation → recommendation keyword
    ├── utils/mapPool.ts    # Shared bounded-concurrency helper (portfolio + fundamentals)
    ├── services/
    │   ├── fundamentals.ts # Daily key-stats / financials / splits sweep
    │   ├── portfolio.ts    # Portfolio + watchlist pipeline CLI entry
    │   ├── news.ts         # RSS fetch + LLM sentiment
    │   ├── watchlist.ts    # Watchlist CRUD (loadWatchlist, add, remove)
    │   ├── gold.ts         # Gold refresh + holdings valuation
    │   ├── funds.ts        # Fund NAV refresh + holdings valuation
    │   ├── bonds.ts        # Bond holdings + coupon schedule sync
    │   └── deepRun.ts      # Multi-agent deep run: enqueue + persona/consensus job handlers
    ├── telegram/
    │   ├── client.ts       # sendTelegram, chunkText (HTML, retry)
    │   └── alerts.ts       # evaluateAlert (deduplication)
    ├── bot/bot.ts          # grammy Telegram bot (all commands)
    └── graph/
        ├── state.ts        # Session, SignalType, OrchestratorState, AnalysisState
        ├── session.ts      # IDX market session detection (WIB time)
        ├── signals.ts      # Signal detection (price move, volume spike)
        ├── analysis.ts     # runAnalysis(target: tickers | watchlist) → pipelines
        ├── orchestrator.ts # runCycle(): session → prices → signals → route → analyze
        ├── runner.ts       # Long-running entry point (SIGTERM-aware)
        └── worker.ts       # Deep-run queue worker (claims analysis_jobs, SIGTERM-aware)
lib/                        # Shared TypeScript (imported by both app/ and web/)
├── types.ts                # Postgres row interfaces
└── format.ts               # Utility functions (fmtIdr, calcPnl, normalizeTicker, …)
db/                         # SQL assets for the Postgres DB (not imported at runtime)
├── schema.sql              # consolidated snapshot = migrations 001–039 (SCHEMA_BASELINE '039'); no RLS
├── migrations/             # incremental changes (040+), applied automatically at startup by app/src/db/migrate.ts
├── imports/                # one-off data-import SQL, gitignored (Stockbit history)
└── seed.sql                # static bootstrap snapshot (optional, hand-edited)
web/                        # Next.js + Tailwind frontend (App Router)
├── app/                    # routes: / (dashboard), /stocks, /news, /gold, /funds, /bonds, /reviews, /login,
│                           #         /api/auth/[...nextauth], /api/weekly-reviews/latest
├── components/             # Nav, MetricCard, RecommendationBadge, *Client, TickerDetail,
│                           #      DetailTabs, KeyStats, FinancialsTable, CorporateActions
├── lib/                    # format.ts, types.ts, db.ts (pg pool), auth.ts (NextAuth), env.ts,
│                           #      tabs.ts + keystats.ts (pure logic, .test.ts siblings)
└── proxy.ts                # Next 16 "proxy" (was middleware): auth/session gate
docker/                     # Docker-related files
├── Dockerfile.app          # Node 24 multi-stage build (deps → builder → runner)
├── Dockerfile.web          # Next.js multi-stage build (build context: repo root)
└── docker-compose.yml      # folionix-db (postgres:18-alpine) / -graph / -bot / -worker / -web
data/                       # Runtime data (gitignored) — Postgres is the source of truth
```

## Knowledge bundle
Data model, sources, and pipeline context live in `knowledge/` (OKF v0.2).
Read `knowledge/index.md` first and traverse from there before reasoning
about schema, data sources, or metric definitions.

## Running Locally

```bash
# Backend setup
cd app && npm install

# Run full portfolio analysis
npm run portfolio

# Price-only refresh (fill snapshots so dashboard prices aren't null)
npm run prices
npm run prices -- BBCA TLKM   # specific tickers

# Watchlist analysis
npm run watchlist

# Weekly review (all-asset WoW, allocation, activity, upcoming events, AI self-review + handover doc; --no-send skips email/Telegram)
npm run weekreview
npm run weekreview -- --no-send

# Telegram bot (long-polling)
npm run bot

# Orchestrator (long-running, signal-aware)
npm run graph

# Multi-agent analysis worker (drains analysis_jobs; --enqueue seeds a deep run)
npm run worker
npm run worker -- --enqueue BBCA

# Next.js dashboard
cd web && npm install && npm run dev    # http://localhost:3000

# Peer valuation: IDX classification → peer groups → watchlist `peer` rows → own-history multiples → valuations (also weekly, ≥ 19:00 WIB)
npm run peers

# Refresh key stats, quarterly financials and splits (also runs daily at 18:00 WIB)
npm run fundamentals
npm run fundamentals -- BBCA BSSR

# Apply pending migrations by hand (also runs automatically at service startup)
npm run migrate
npm run migrate -- --check   # report pending, exit 1, apply nothing

# Tests + typecheck
cd app && npm test
cd app && npm run typecheck

# Build production bundles
cd app && npm run build
```

## Docker

Services in `docker/docker-compose.yml`: `folionix-db` (`postgres:18-alpine`, `pgdata` volume at `/var/lib/postgresql` — a 17 volume cannot be reused, dump/restore; port bound to 127.0.0.1), `folionix-graph` (orchestrator), `folionix-bot` (Telegram), `folionix-worker` (multi-agent analysis-job worker), `folionix-web` (Next.js on 3000). Postgres is vendored into this compose file — bootstrap it per `knowledge/runbooks/postgres-foundation.md`. All share `.env`.

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f folionix-graph
```

`folionix-bot`/`folionix-graph` reach host Ollama via `extra_hosts: ollama-host:host-gateway`. Pin a specific deploy with `FOLIONIX_TAG=<sha8> docker compose -f docker/docker-compose.yml up -d` (CI pushes sha-tagged images alongside `:latest`; default is `latest`).
CI/CD: GitHub Actions (`.github/workflows/build.yml`) builds/pushes two multi-arch (`linux/amd64`, `linux/arm64`) images to Docker Hub, gated on tsc + vitest (against a Postgres 18 service: `schema.sql` + every migration applied, then `migrate --check`, plus the `*.integration.test.ts` live-DB tests) + web tsc/test/build: the Node image `marvellooni/folionix-app` (from `docker/Dockerfile.app`, build context: repo root) and the Next.js web image `marvellooni/folionix-web` (from `docker/Dockerfile.web`; `NEXT_PUBLIC_*` are read at runtime via `window.__ENV` injection, not baked at build). Each arch builds natively (amd64 on `ubuntu-26.04`, arm64 on `ubuntu-24.04-arm` — no QEMU) with `type=gha` layer caching, pushes by digest, and a `merge` job assembles the multi-arch `:latest` + `:<sha8>` manifests. `docker/Dockerfile.app` installs deps in their own layer from the root `package.json` + `package-lock.json` plus `app/package.json` (`npm ci --omit=dev -w app` — this is an npm workspace monorepo; the root lockfile is the only one), then copies `app/` + `lib/` and runs `node build.mjs` — keep dependency edits in `app/package.json` and don't reorder those steps.

## Architecture

```
app/src/services/portfolio.ts  →  yahoo-finance2 → Vercel AI SDK LLM → Telegram alerts
app/src/graph/runner.ts        →  orchestrator loop (session-aware, signal-driven; daily jobs latched in scheduled_runs)
app/src/services/gold.ts       →  cermati GraphQL → gold_snapshots
app/src/services/funds.ts      →  cermati NAV REST → fund_catalog + fund_snapshots
app/src/services/bonds.ts      →  par value (no provider; principal entered manually, web-only)
app/src/services/fundamentals.ts → yahoo quoteSummary + chart → stock_key_stats + stock_financials + corporate_actions
app/src/services/weekReview.ts →  weekly review (lib/aggregate WoW + allocation + activity + coming up + rec ledger + LLM self-critique) → weekly_reviews + email + Telegram
app/src/graph/worker.ts        →  multi-agent deep runs (analysis_jobs queue → persona LLM calls → consensus → llm_analyses + Telegram)
       ↓ (saves)
     app/src/db/db.ts  ←→  Postgres (node-postgres pool, raw SQL) via DATABASE_URL
       ↑ (reads)
     app/src/bot/bot.ts  ←→  Telegram commands (grammy; /status, /add (records a BUY), /remove (hides), /update (retired), /analyze, /wadd, /wremove, /wlist, /gadd, /glist, /gremove, /gprice, /flist, /fxrefresh, /blist, /weekreview)
     web/               ←→  Next.js dashboard reads/writes Postgres directly (its own pg pool)
```

- **app/src/services/portfolio.ts**: Portfolio pipeline entry (`runPortfolioPipeline`), watchlist pipeline (`runWatchlistPipeline`), price-only refresh (`runPriceRefresh`). Fans out per ticker through providers/market → ai/llm → sends Telegram alerts via telegram/client.
- **app/src/providers/market.ts**: `fetchStock` — per-ticker snapshot (price, day change, 52w range, fundamentals, P&L) via yahoo-finance2, with DB snapshot caching.
- **app/src/ai/llm.ts**: Vercel AI SDK (`streamText`, not `generateText` — gateways answer SSE even for non-streamed calls) primary/fallback chain. Both backends (`LLM_BACKEND` = `ollama`, or `openai` for any OpenAI-compatible gateway) go through `@ai-sdk/openai` `createOpenAI(...).chat()` (not `ollama-ai-provider`, which ai>=5 doesn't support). Exports `callLlm`, `extractRecommendation`, `cleanForTelegram`, `extractJson`.
- **app/src/ai/prompts.ts**: `buildPrompt` — portfolio-analysis prompt builder (`depth`: LIGHT/FULL/DEEP), WIB session context via `detectSession()`. Output template ends with a mandatory `REKOMENDASI: <keyword>` line (what `extractRecommendation` reads). Held positions get action sizing vs the Rp 1jt threshold; watchlist tickers get a pure entry signal (BUY/MONITOR/HOLD) with no threshold. Optional TECHNICALS block from **app/src/ai/indicators.ts** (SMA20/50, RSI14, 1W momentum, volume vs 20d avg, IHSG relative strength — all computed from our own `stock_snapshots` history, no external provider).
- **app/src/providers/finnhub.ts**: Best-effort Finnhub REST fallback; disabled when `FINNHUB_API_KEY` unset. Caveat: USD prices, not IDR.
- **app/src/db/db.ts**: Postgres data layer — a `node-postgres` pool over `DATABASE_URL`, raw parameterised SQL through a local `q()` helper. Date/timestamp OIDs (1082/1114/1184) are parsed as ISO strings so callers can `.slice()` and compare them. Tables: `stock_snapshots`, `llm_analyses`, `news_cache`, `news_sentiments`, `stock_transactions`, `portfolio_positions`, `stock_dividends`, `watchlist`, `gold_purchases`, `gold_snapshots`, `fund_catalog`, `fund_snapshots`, `fund_purchases`, `fund_distributions`, `bond_holdings`, `weekly_reviews`, `analysis_jobs`, `persona_analyses`, `stock_key_stats`, `stock_financials`, `corporate_actions`; views `latest_snapshots`/`latest_analyses`/`latest_gold_prices`/`latest_fund_navs`/`fund_product_summary`/`corporate_actions_all`; RPC `recommendation_accuracy`, `claim_analysis_job` (atomic `FOR UPDATE SKIP LOCKED` job claim). Stocks are now transaction-backed: `stock_transactions` is the source of truth (BUY/SELL ledger); `portfolio_positions` (avg_price, lots, `realized_pnl`) is a derived cache recomputed by statement-level triggers (once per affected ticker per statement, advisory-locked per ticker) — never write it directly. Ledger money/quantity columns are `numeric` (migration 046); both pg pools parse numeric (OID 1700) to JS numbers. `gold_purchases`/`fund_purchases` carry a `side` (BUY default | SELL); holdings are netted buys − sells.
- **app/src/bot/bot.ts**: grammy Telegram bot with chat ID whitelisting. All 16 commands. `/add`/`/wadd` call `runPriceRefresh` after adding.
- **web/**: Next.js + Tailwind dashboard (App Router). The stock detail page is tabbed — Overview (Key Stats), Analysis, Financials, Actions, History — with tab state in `?tab=` searchParams so it stays an async Server Component and each render queries only the active tab's tables. Pure tab and stat-group logic lives in `web/lib/tabs.ts` and `web/lib/keystats.ts` with `.test.ts` siblings, because `web/vitest.config.ts` runs `environment: "node"` with no jsdom. `web/lib/format.ts` holds web-only display helpers; shared logic (`sanitizeHtml`, `escapeHtml`, `calcPnl`, …) is imported from `@folionix/lib` — don't re-implement it in web. Every Server Action in `web/app/actions.ts` calls `requireSession()` and validates its input server-side (`proxy.ts` is not a security boundary for actions). Pages: Dashboard, Portfolio (+CRUD), Watchlist (+CRUD), News, Gold (+CRUD, holdings valued at venue sell-back price), Funds (+CRUD, add via `fund_catalog` autocomplete search, holdings valued at latest NAV), Bonds (+CRUD, valued at par/principal), Reviews (read-only weekly-review reports rendered from markdown, with copy-to-clipboard handover doc). Reads/writes Postgres directly through its own `pg` pool (`web/lib/db.ts`); there is no backend API in the path. Login is email + password via NextAuth Credentials + bcrypt against `public.users` (`web/lib/auth.ts`, JWT sessions), gated by `web/proxy.ts`; there is no public sign-up.
- **app/src/services/fundamentals.ts**: `refreshFundamentals` — daily sweep over held + watchlist tickers through `utils/mapPool`, writing `stock_key_stats`, `stock_financials` and `corporate_actions` (SPLIT). Per-ticker failures are recorded and skipped, never fatal. Scheduled at `FUNDAMENTALS_HOUR_WIB` (18:00 WIB) by the graph runner; manual via `npm run fundamentals`. **Currency caveat**: yahoo quotes IDX prices in IDR but reports `bookValue` in the issuer's financial currency, so `price_to_book` goes through `correctPriceToBook` and `book_value` is converted with the fx rate (BSSR's raw P/B is 48,529 against a true ~3.0). `trailing_eps`/`forward_eps` are already in the quote currency and are NOT converted.
- **Peer valuation** (`app/src/services/peers.ts`, `app/src/ai/valuation.ts`, migration 049): the official IDX-IC classification for every listing (`providers/idx.ts fetchClassifications` — IDX `/primary/ListedCompany/GetCompanyProfiles`; the `/support/...` stock-screener API is behind a Cloudflare JS challenge) → `stock_classification`. Each **holding** gets peers = same sub-industry (industry when < 3), top 8 by market cap → `stock_peers`; peers are added to the watchlist as kind `peer` with a reason ("Peer of BBCA, BMRI · Bank") and get **full watchlist treatment**; the refresh only ever touches `peer` rows, skips held tickers, and the UI can promote a peer to `user`. Valuation is a pure 3-way comparison on the sector-appropriate multiple (Keuangan P/B↔ROE; consumer/health P/E↔earnings growth; infra/transport/industrials EV/EBITDA↔EBITDA margin; energy/basic materials EV/EBITDA on 4-yr avg EBITDA↔net debt/EBITDA; tech or loss-making P/S↔revenue growth; property P/B↔dividend yield): vs peer median (±15% on par, ≥ 3 peers), quality metric vs peers (does it justify the gap), vs own 4-yr average (`stock_annual_multiples`, yahoo annuals + year-end price). All money fx-corrected to IDR in code (yahoo's own EV/EBITDA is wrong for USD reporters). Result → `stock_valuation` (summary + jsonb), read by the analysis prompt (VALUATION block; DEEP restores a grounded Sector Comparison), persona prompts, the relative valuation sub-score, and the holdings table's Peers row. Weekly refresh claims `scheduled_runs('peer-refresh', <week Monday>)` at ≥ 19:00 WIB; valuations are recomputed daily after the 18:00 fundamentals sweep.
- **app/src/services/watchlist.ts**: `loadWatchlist`, `addToWatchlist`, `removeFromWatchlist`; splits user vs ai_suggested rows.
- **lib/format.ts**: Shared helpers (fmtIdr, fmtCap, calcPnl, pnlIcon, normalizeTicker, valueHolding, sanitizeHtml, WIB).
- **app/src/graph/**: plain-TypeScript orchestrator (LangGraph removed — it was a straight line with one branch). `runCycle(state)`: session detection → price refresh → signal check → routing → `runAnalysis` (spikes → those tickers, alerting; scheduled/session-boundary → watchlist, silent; held positions get the runner's daily silent baseline). Daily jobs (bonds, dividends, forex, fund NAVs, fundamentals, week review, retention, portfolio baseline) claim a `scheduled_runs` row first, so restarts never repeat them. The idle sleep polls `price_refresh_requests` every 30s and wakes on SIGTERM. Runner and worker stamp a heartbeat file (`app/src/utils/heartbeat.ts`, `HEARTBEAT_FILE`, default `/tmp/folionix-heartbeat`) each loop; the k8s liveness probe / compose healthcheck runs `node dist/utils/heartbeat.js <maxAgeSec>` (runner 3600, worker 1800). Web exposes `/api/health` (DB ping) for probes. Runs as long-running process with SIGTERM handling. Signal-aware, market-session-aware monitoring (ACTIVE_INTERVAL during market hours, IDLE_INTERVAL otherwise).
- **app/src/services/deepRun.ts** + **app/src/graph/worker.ts**: multi-agent deep runs (gated by `DEEP_RUNS_ENABLED`). MAJOR signals enqueue one run = N persona jobs + 1 consensus job (`analysis_jobs`, shared `run_id`; deterministic `ai/scores.ts` payload computed once at enqueue). The worker claims jobs via the `claim_analysis_job` RPC, runs persona LLM calls (`ai/personas.ts`, JSON verdicts → `persona_analyses`), then consensus (`ai/consensus.ts` decides the keyword deterministically; LLM renders prose) → `saveAnalysis` as `consensus:<model>` + spike Telegram alert. Enqueue failure falls back to the inline single-pass.
- **app/src/services/gold.ts**: `refreshGoldPrices` (cermati GraphQL → gold_snapshots), `listGoldHoldings` (valued at venue sell-back price). Re-exports `addGoldPurchase`/`deactivateGoldPurchase`.
- **app/src/services/funds.ts**: `refreshFundNavs` (cermati REST sweep → fund_catalog + fund_snapshots), `listFundHoldings` (valued at latest NAV via `latest_fund_navs` view). Mutations are web-only.
- **app/src/services/bonds.ts**: `listBondHoldings` (valued at par, days to maturity computed), `syncBondCouponSchedules` (KSEI HTML scrape for SR/ORI/SBR/ST series), `recordCouponPayment`. Mutations are web-only.
- **app/src/services/weekReview.ts**: `runWeekReview` — weekly retrospective (all assets WoW via shared `lib/aggregate.ts` incl. gold price / fund NAV per-unit moves; allocation & concentration — class share of net worth, top-5 holdings, ⚠️ above 60% class / 20% single non-bond holding, per-holding values via `aggregatePortfolio` on that holding's rows; activity — trades, income received, fees by WIB day in (weekStart, weekEnd]; coming up — held-ticker dividend ex/pay dates + bond coupons in 14 days, maturities in 90; recommendation ledger + `recommendation_accuracy` RPC, local-LLM self-critique, external-LLM handover doc) saved to `weekly_reviews`, emailed via Brevo (`services/email.ts`) and pinged to Telegram. Scheduled Saturday ≥ 09:00 WIB by the graph runner; manual via `/weekreview` bot command or `npm run weekreview`.
- **lib/aggregate.ts**: `aggregatePortfolio` — pure portfolio-wide aggregation (net worth, capital, income, fees, total return, per-product summary) shared by the web dashboard and the week review. Root `lib/` is the `@folionix/lib` workspace package; web imports it directly (`import { aggregatePortfolio } from "@folionix/lib"`).

## Key Configuration

- **Postgres**: source of truth for positions (`portfolio_positions`) and watchlist (`watchlist`, kind = user | ai_suggested | peer). Managed via the bot (`/add`, `/wadd`, …) and web UI. 1 lot = 100 shares. `db/seed.sql` is an optional static bootstrap. The DB runs as the `folionix-db` compose service (`postgres:17-alpine`, `pgdata` volume); the backend connects as the DB owner.
- **.env**: `DATABASE_URL` (Postgres connection string — read by both `app/` and `web/`; there are no separate backend/frontend DB creds), `AUTH_SECRET` + `AUTH_URL` (NextAuth), `FOLIONIX_WEB_URL` + `AIREVIEW_API_TOKEN` (the `/aireview` local command curls the deployed web app because the DB is not reachable from a dev machine), `NEWS_CACHE_HOURS`, `NEWS_FETCH_ENABLED`, `LLM_BACKEND`, `LLM_MODEL`, `LLM_API_BASE`, `LLM_API_KEY`, `LLM_NUM_PREDICT` (max output tokens; context window is server-side — `OLLAMA_CONTEXT_LENGTH`/Modelfile, not an app var), plus optional fallback `LLM_FALLBACK_BACKEND`/`LLM_FALLBACK_MODEL`/`LLM_FALLBACK_API_BASE`/`LLM_FALLBACK_API_KEY` (each defaults to the primary's value) (legacy `OLLAMA_URL`/`OLLAMA_MODEL`/`OLLAMA_NUM_PREDICT` still read as fallbacks), `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `CACHE_MINUTES`, `SEND_TELEGRAM`, `SIGNAL_PRICE_MINOR`, `SIGNAL_PRICE_MAJOR`, `SIGNAL_VOLUME_MINOR`, `SIGNAL_VOLUME_MAJOR`, `SIGNAL_COOLDOWN_MIN`, `GRAPH_ACTIVE_INTERVAL`/`GRAPH_IDLE_INTERVAL` (runner loop sleep, in minutes), `GRAPH_ANALYSIS_INTERVAL` (scheduled analysis cadence, minutes, default 30), `GOLD_REFRESH_HOURS` (gold price refresh cadence, hours, default 3 — independent of the daily 17:00 WIB fund NAV sweep), `REC_STABILITY_PCT` (skip re-analysis while price has moved less than this % since the price the last recommendation was made at, default 2), `REC_MAX_AGE_HOURS` (force a refresh once the last call is older than this even if price never moved, default 72), `FUNDAMENTALS_HOUR_WIB` (hour of the daily fundamentals sweep, default 18; 0 is a valid hour, and a non-numeric value falls back to 18 with a console warning), `PROVIDER_CONCURRENCY` (bounded fan-out for provider fetches, default 4 - read by both `services/portfolio.ts` and `services/fundamentals.ts`), `FINNHUB_API_KEY` (optional fallback), `FINNHUB_BASE_URL`, `CERMATI_GRAPHQL_URL` (Cermati gold-price GraphQL endpoint), `CERMATI_COOKIE` (optional fallback auth), `CERMATI_MF_URL` (optional; Cermati mutual-fund products REST endpoint, defaults to `https://invest.cermati.com/api/v2/mutual-funds/products`), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM`/`EMAIL_TO` (weekly-review email via Brevo SMTP; alternates `SMTP_SERVER`/`SMTP_USERNAME`/`SMPT_USERNAME`/`SMTP_PASSWORD` also read; email skipped when unset), `DEEP_RUNS_ENABLED` (default false — MAJOR signals enqueue multi-agent deep runs instead of the inline single pass), `PERSONAS` (enabled investor personas — comma list of names, a number = first N of a style-balanced order, or `all`; default the balanced six: buffett, burry, lynch, druckenmiller, graham, wood), `WORKER_POLL_SEC` (worker idle poll, default 10), `WORKER_MAX_ATTEMPTS` (job retries, default 3), `CONSENSUS_MIN_PERSONAS` (default half of enabled), `DEEP_RUN_STALE_MIN` (periodic sweep for stuck running jobs, default 120; at boot every running job is requeued), `LLM_TIMEOUT_MS` (per-call total, default 180000) / `LLM_CHUNK_TIMEOUT_MS` (stream stall, default 60000), `RETENTION_DAYS` (opt-in history thinning, unset = keep everything), `AIREVIEW_API_TOKEN` (also passed to `folionix-web` in compose), `BCRYPT_ROUNDS` (web: cost of the dummy hash used for unknown emails, default 12)
- Tickers are stored everywhere as the yahoo symbol (`BBCA.JK`, `^JKSE` for IHSG) via `normalizeTicker` — snapshots, analyses, positions, transactions, watchlist, news, dividends (migration `024_ticker_yahoo_symbol.sql`; future-proofs non-IDX markets). UI/Telegram strip the suffix for display via `displayTicker`; URLs carry the plain code
- All timestamps stored UTC, displayed in WIB (Asia/Jakarta, UTC+7)
- Local TypeScript imports are extensionless or `.js` (bundler resolution; esbuild bundles app, `lib/` included)

## Conventions

- Snake_case for DB column names; camelCase for TypeScript variables
- Section separators: `// ── SECTION NAME ──`
- All code, comments, prompts, and user-facing strings in English (the Google News search query keeps the Indonesian term `saham` to fetch local-market news)
- Telegram messages use HTML formatting, not Markdown
- P&L status emoji: 🟢 PROFIT, ⚪ BREAKEVEN, 🟡 SMALL LOSS, 🔴 LOSS
- All persistent data lives in Postgres (no local JSON/SQLite source of truth)
- Web CRUD (every add/edit) opens a centered modal dialog via `web/components/Modal.tsx`, never an inline form between rows (see `knowledge/design.md` → Components → Dialogs)
- Migrations are tracked in `public.schema_migrations` (version, name, applied_at, checksum). Every new file in `db/migrations/` **must end** with `insert into public.schema_migrations (version, name) values ('NNN', 'NNN_name') on conflict do nothing;` and must **not** contain its own BEGIN/COMMIT (the runner rejects it). Pending migrations are applied automatically at startup by `app/src/db/migrate.ts` — `runPendingMigrations()` runs before `bot.ts`, `runner.ts` and `worker.ts` begin work, applying missing files in numeric order, each in its own transaction with `lock_timeout 10s`, under a `pg_advisory_lock` so the three services can start together (the migrator session disables the pool's 30s `statement_timeout`). A failing migration rolls back and the process exits non-zero. Run it by hand with `npm run migrate`, or `npm run migrate -- --check` (reports pending **and applied files edited since they ran** — sha256 checksums — and exits 1 on either; CI runs it). Never edit an applied migration: the edit never runs; add a new one. The runner **never bootstraps**: an absent `schema_migrations` is a hard error. `db/schema.sql` is the consolidated snapshot of 001–039 and registers all of them; `SCHEMA_BASELINE` (`'039'`) is the highest migration in every live database, the runner never executes anything at or below it, and files up to it were removed from `db/migrations/` (2026-10-06, after confirming every live ledger complete) — they live in git history. Bump `SCHEMA_BASELINE` only when a migration is in every live database **and** folded into `schema.sql`.

## Security

- Docker runs as non-root (`appuser`)
- Never expose internal errors/stack traces to users — log internally, show generic message
- Ticker inputs: bot `^[A-Z0-9]{1,7}$`; server actions accept stored symbols `^(\^JKSE|[A-Z0-9]{1,7}\.JK)$`
- No RLS (dropped in migration 035). Auth is enforced by NextAuth + `web/proxy.ts`; both app and web connect as the DB owner, so any DB access is full access — keep `DATABASE_URL` off the client
- Telegram HTML: interpolate user/DB text through `escapeHtml`; LLM output only through `sanitizeHtml` (bare b/i/u/s/code/pre, never attributes). `sendTelegram` returns whether delivery succeeded — persist that, not intent.
- Login (`web/lib/auth.ts`): per-email + per-IP throttle (`web/lib/loginThrottle.ts`), constant-time unknown-email path, failures logged.
- Untrusted text (RSS / scraped pages) enters prompts only fenced in `<news><article>` and marked untrusted (`services/news.ts`).
- Secrets via `.env` only, never hardcoded; `DATABASE_URL` and `AUTH_SECRET` are server-side only — never expose them via `NEXT_PUBLIC_*`

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
