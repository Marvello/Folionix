# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## References
- **knowledge/design.md** : brand guideline for Folionix its identity and styling it need to follow.

## What This Is

Indonesian stock portfolio (IDX) analyzer. Fetches market data via yahoo-finance2, runs LLM analysis via Vercel AI SDK (Ollama/LiteLLM), sends alerts to Telegram, stores everything in self-hosted Supabase, and provides a Next.js + Tailwind dashboard (`web/`). Node 24 + TypeScript backend (`app/`); Node 24 frontend (`web/`).

## Project Structure

```
app/                        # Node 24 TypeScript backend (ESM, esbuild)
├── package.json            # deps + scripts: bot/graph/prices/portfolio/watchlist/test/typecheck/build
├── tsconfig.json           # NodeNext, strict, noEmit, includes ../lib/**/*
├── build.mjs               # esbuild bundle (bot, graph/runner, services/portfolio)
└── src/
    ├── db/db.ts            # Supabase data layer (@supabase/supabase-js / PostgREST)
    ├── providers/
    │   ├── market.ts       # yahoo-finance2 stock fetch (price, fundamentals, P&L)
    │   ├── finnhub.ts      # Finnhub REST fallback provider
    │   ├── cermati.ts      # Gold GraphQL + Fund NAV REST (Cermati)
    │   └── ksei.ts         # Bond coupon schedule (HTML scrape)
    ├── ai/
    │   ├── llm.ts          # Vercel AI SDK primary/fallback chain (Ollama/LiteLLM)
    │   ├── prompts.ts      # Portfolio-analysis prompt builder
    │   ├── scores.ts       # Deterministic analyst sub-scores (no LLM)
    │   ├── personas.ts     # 12 investor personas (prompt + JSON verdict parsing)
    │   └── consensus.ts    # Persona-vote aggregation → recommendation keyword
    ├── services/
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
        ├── analysis.ts     # Inner graph: analysis pipeline
        ├── orchestrator.ts # Outer graph: session + signal routing
        ├── runner.ts       # Long-running entry point (SIGTERM-aware)
        └── worker.ts       # Deep-run queue worker (claims analysis_jobs, SIGTERM-aware)
lib/                        # Shared TypeScript (imported by both app/ and web/)
├── types.ts                # Supabase row interfaces (12 types)
└── format.ts               # Utility functions (fmtIdr, calcPnl, normalizeTicker, …)
supabase/                   # Supabase infra assets (SQL + key-gen tool; not imported at runtime)
├── schema.sql              # tables + views + RPC + RLS
├── migrations/             # incremental schema changes
├── seed.sql                # static bootstrap snapshot (optional, hand-edited)
└── gen_keys.py             # JWT anon/service key generator (CLI)
web/                        # Next.js + Tailwind frontend (App Router)
├── app/                    # routes: / (dashboard), /portfolio, /watchlist, /news, /gold, /funds, /bonds, /login
├── components/             # Nav, MetricCard, RecommendationBadge, *Client, TickerDetail
├── lib/                    # format.ts, types.ts, supabase/{client,server}.ts
└── proxy.ts                # Next 16 "proxy" (was middleware): auth/session gate
docker/                     # Docker-related files
├── Dockerfile.app          # Node 24 multi-stage build (deps → builder → runner)
├── Dockerfile.web          # Next.js multi-stage build (build context: repo root)
└── docker-compose.yml      # folionix-graph / folionix-bot / folionix-web (Supabase runs as a separate, un-vendored stack)
data/                       # Runtime data (gitignored) — Supabase is the source of truth
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

# Weekly review (portfolio WoW + AI self-review + handover doc; --no-send skips email/Telegram)
npm run weekreview
npm run weekreview -- --no-send

# Telegram bot (long-polling)
npm run bot

# LangGraph orchestrator (long-running, signal-aware)
npm run graph

# Multi-agent analysis worker (drains analysis_jobs; --enqueue seeds a deep run)
npm run worker
npm run worker -- --enqueue BBCA

# Next.js dashboard
cd web && npm install && npm run dev    # http://localhost:3000

# Tests + typecheck
cd app && npm test
cd app && npm run typecheck

# Build production bundles
cd app && npm run build
```

## Docker

Services in `docker/docker-compose.yml`: `folionix-graph` (LangGraph orchestrator), `folionix-bot` (Telegram), `folionix-worker` (multi-agent analysis-job worker), `folionix-web` (Next.js on 3000). Self-hosted Supabase runs as its **own separate stack — not vendored into this repo** (bootstrap it locally per `knowledge/runbooks/supabase-foundation.md`; treat `docker/supabase/` as throwaway local infra, never commit it). All share `.env`.

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f folionix-graph
```

`folionix-bot`/`folionix-graph` reach host Ollama via `extra_hosts: ollama-host:host-gateway`. The self-hosted Supabase stack runs separately and is not part of this repo. Pin a specific deploy with `FOLIONIX_TAG=<sha8> docker compose -f docker/docker-compose.yml up -d` (CI pushes sha-tagged images alongside `:latest`; default is `latest`).
CI/CD: GitHub Actions (`.github/workflows/build.yml`) builds/pushes two multi-arch (`linux/amd64`, `linux/arm64`) images to Docker Hub, gated on tsc + vitest + web build: the Node image `marvellooni/folionix-app` (from `docker/Dockerfile.app`, build context: repo root) and the Next.js web image `marvellooni/folionix-web` (from `docker/Dockerfile.web`; `NEXT_PUBLIC_*` are read at runtime via `window.__ENV` injection, not baked at build). Each arch builds natively (amd64 on `ubuntu-latest`, arm64 on `ubuntu-24.04-arm` — no QEMU) with `type=gha` layer caching, pushes by digest, and a `merge` job assembles the multi-arch `:latest` + `:<sha8>` manifests. `docker/Dockerfile.app` installs deps from `app/package*.json` in their own layer (`npm ci --omit=dev`), then copies `app/` + `lib/` and runs `node build.mjs` — keep dependency edits in `app/package.json` and don't reorder those steps.

## Architecture

```
app/src/services/portfolio.ts  →  yahoo-finance2 → Vercel AI SDK LLM → Telegram alerts
app/src/graph/runner.ts        →  LangGraph orchestrator (session-aware, signal-driven)
app/src/services/gold.ts       →  cermati GraphQL → gold_snapshots
app/src/services/funds.ts      →  cermati NAV REST → fund_catalog + fund_snapshots
app/src/services/bonds.ts      →  par value (no provider; principal entered manually, web-only)
app/src/services/weekReview.ts →  weekly review (lib/aggregate WoW + rec ledger + LLM self-critique) → weekly_reviews + email + Telegram
app/src/graph/worker.ts        →  multi-agent deep runs (analysis_jobs queue → persona LLM calls → consensus → llm_analyses + Telegram)
       ↓ (saves)
     app/src/db/db.ts  ←→  Supabase (PostgREST) via @supabase/supabase-js
       ↑ (reads)
     app/src/bot/bot.ts  ←→  Telegram commands (grammy; /status, /add, /update, /remove, /analyze, /wadd, /wremove, /wlist, /gadd, /glist, /gremove, /gprice, /flist, /blist, /weekreview)
     web/               ←→  Next.js dashboard reads/writes Supabase directly (supabase-js + RLS)
```

- **app/src/services/portfolio.ts**: Portfolio pipeline entry (`runPortfolioPipeline`), watchlist pipeline (`runWatchlistPipeline`), price-only refresh (`runPriceRefresh`). Fans out per ticker through providers/market → ai/llm → sends Telegram alerts via telegram/client.
- **app/src/providers/market.ts**: `fetchStock` — per-ticker snapshot (price, day change, 52w range, fundamentals, P&L) via yahoo-finance2, with DB snapshot caching.
- **app/src/ai/llm.ts**: Vercel AI SDK (`generateText`) primary/fallback chain. Backend via `LLM_BACKEND` (`ollama` → `createOllama` | `litellm` → `@ai-sdk/openai` compat). Exports `callLlm`, `extractRecommendation`, `cleanForTelegram`.
- **app/src/ai/prompts.ts**: `buildPrompt` — portfolio-analysis prompt builder (`depth`: LIGHT/FULL/DEEP), WIB session context via `detectSession()`. Output template ends with a mandatory `REKOMENDASI: <keyword>` line (what `extractRecommendation` reads). Held positions get action sizing vs the Rp 1jt threshold; watchlist tickers get a pure entry signal (BUY/MONITOR/HOLD) with no threshold. Optional TECHNICALS block from **app/src/ai/indicators.ts** (SMA20/50, RSI14, 1W momentum, volume vs 20d avg, IHSG relative strength — all computed from our own `stock_snapshots` history, no external provider).
- **app/src/providers/finnhub.ts**: Best-effort Finnhub REST fallback; disabled when `FINNHUB_API_KEY` unset. Caveat: USD prices, not IDR.
- **app/src/db/db.ts**: Supabase data layer via `@supabase/supabase-js` (PostgREST). Tables: `stock_snapshots`, `llm_analyses`, `news_cache`, `news_sentiments`, `stock_transactions`, `portfolio_positions`, `stock_dividends`, `watchlist`, `gold_purchases`, `gold_snapshots`, `fund_catalog`, `fund_snapshots`, `fund_purchases`, `fund_distributions`, `bond_holdings`, `weekly_reviews`, `analysis_jobs`, `persona_analyses`; views `latest_snapshots`/`latest_analyses`/`latest_gold_prices`/`latest_fund_navs`/`fund_product_summary`; RPC `recommendation_accuracy`, `claim_analysis_job` (atomic `FOR UPDATE SKIP LOCKED` job claim). Stocks are now transaction-backed: `stock_transactions` is the source of truth (BUY/SELL ledger); `portfolio_positions` (avg_price, lots, `realized_pnl`) is a derived cache recomputed by a Postgres trigger on every `stock_transactions` write. `gold_purchases`/`fund_purchases` carry a `side` (BUY default | SELL); holdings are netted buys − sells.
- **app/src/bot/bot.ts**: grammy Telegram bot with chat ID whitelisting. All 16 commands. `/add`/`/wadd` call `runPriceRefresh` after adding.
- **web/**: Next.js + Tailwind dashboard (App Router). Pages: Dashboard, Portfolio (+CRUD), Watchlist (+CRUD), News, Gold (+CRUD, holdings valued at venue sell-back price), Funds (+CRUD, add via `fund_catalog` autocomplete search, holdings valued at latest NAV), Bonds (+CRUD, valued at par/principal), Reviews (read-only weekly-review reports rendered from markdown, with copy-to-clipboard handover doc). Reads/writes Supabase directly via `supabase-js` under Supabase Auth + RLS. Login is email + password via Supabase Auth (`signInWithPassword`); there is no public sign-up.
- **app/src/services/watchlist.ts**: `loadWatchlist`, `addToWatchlist`, `removeFromWatchlist`; splits user vs ai_suggested rows.
- **lib/format.ts**: Shared helpers (fmtIdr, fmtCap, calcPnl, pnlIcon, normalizeTicker, valueHolding, sanitizeHtml, WIB).
- **app/src/graph/**: LangGraph orchestrator (`@langchain/langgraph`). Outer orchestrator (session detection → price refresh → signal check → routing) and inner analysis graph (delegates to portfolio pipeline). Runs as long-running process with SIGTERM handling. Signal-aware, market-session-aware monitoring (ACTIVE_INTERVAL during market hours, IDLE_INTERVAL otherwise).
- **app/src/services/deepRun.ts** + **app/src/graph/worker.ts**: multi-agent deep runs (gated by `DEEP_RUNS_ENABLED`). MAJOR signals enqueue one run = N persona jobs + 1 consensus job (`analysis_jobs`, shared `run_id`; deterministic `ai/scores.ts` payload computed once at enqueue). The worker claims jobs via the `claim_analysis_job` RPC, runs persona LLM calls (`ai/personas.ts`, JSON verdicts → `persona_analyses`), then consensus (`ai/consensus.ts` decides the keyword deterministically; LLM renders prose) → `saveAnalysis` as `consensus:<model>` + spike Telegram alert. Enqueue failure falls back to the inline single-pass.
- **app/src/services/gold.ts**: `refreshGoldPrices` (cermati GraphQL → gold_snapshots), `listGoldHoldings` (valued at venue sell-back price). Re-exports `addGoldPurchase`/`deactivateGoldPurchase`.
- **app/src/services/funds.ts**: `refreshFundNavs` (cermati REST sweep → fund_catalog + fund_snapshots), `listFundHoldings` (valued at latest NAV via `latest_fund_navs` view). Mutations are web-only.
- **app/src/services/bonds.ts**: `listBondHoldings` (valued at par, days to maturity computed), `syncBondCouponSchedules` (KSEI HTML scrape for SR/ORI/SBR/ST series), `recordCouponPayment`. Mutations are web-only.
- **app/src/services/weekReview.ts**: `runWeekReview` — weekly retrospective (all assets WoW via shared `lib/aggregate.ts`, recommendation ledger + `recommendation_accuracy` RPC, local-LLM self-critique, external-LLM handover doc) saved to `weekly_reviews`, emailed via Brevo (`services/email.ts`) and pinged to Telegram. Scheduled Saturday ≥ 09:00 WIB by the graph runner; manual via `/weekreview` bot command or `npm run weekreview`.
- **lib/aggregate.ts**: `aggregatePortfolio` — pure portfolio-wide aggregation (net worth, capital, income, fees, total return, per-product summary) shared by the web dashboard and the week review. `web/lib/aggregate.ts` is a verbatim web-local copy (web is isolated from repo-root `lib/`, like `ledger.ts`) — keep in sync manually.

## Key Configuration

- **Supabase**: source of truth for positions (`portfolio_positions`) and watchlist (`watchlist`, kind = user | ai_suggested). Managed via the bot (`/add`, `/wadd`, …) and web UI. 1 lot = 100 shares. `supabase/seed.sql` is an optional static bootstrap.
- **.env**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (backend), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web), `LLM_BACKEND`, `LLM_MODEL`, `LLM_API_BASE`, `LLM_API_KEY`, `LLM_NUM_PREDICT` (max output tokens; context window is server-side — `OLLAMA_CONTEXT_LENGTH`/Modelfile, not an app var), plus optional fallback `LLM_FALLBACK_BACKEND`/`LLM_FALLBACK_MODEL`/`LLM_FALLBACK_API_BASE`/`LLM_FALLBACK_API_KEY` (each defaults to the primary's value) (legacy `OLLAMA_URL`/`OLLAMA_MODEL`/`OLLAMA_NUM_PREDICT` still read as fallbacks), `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `CACHE_MINUTES`, `ACTION_THRESHOLD_IDR`, `SEND_TELEGRAM`, `SIGNAL_PRICE_MINOR`, `SIGNAL_PRICE_MAJOR`, `SIGNAL_VOLUME_MINOR`, `SIGNAL_VOLUME_MAJOR`, `SIGNAL_COOLDOWN_MIN`, `GRAPH_ACTIVE_INTERVAL`/`GRAPH_IDLE_INTERVAL` (runner loop sleep, in minutes), `GRAPH_ANALYSIS_INTERVAL` (scheduled analysis cadence, minutes, default 30), `GOLD_REFRESH_HOURS` (gold price refresh cadence, hours, default 3 — independent of the daily 17:00 WIB fund NAV sweep), `GRAPH_SEND_TELEGRAM`, `REC_STABILITY_PCT` (skip re-analysis if same WIB day and price moved less than this %, default 2), `FINNHUB_API_KEY` (optional fallback), `FINNHUB_BASE_URL`, `CERMATI_GRAPHQL_URL` (Cermati gold-price GraphQL endpoint), `CERMATI_COOKIE` (optional fallback auth), `CERMATI_MF_URL` (optional; Cermati mutual-fund products REST endpoint, defaults to `https://invest.cermati.com/api/v2/mutual-funds/products`), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM`/`EMAIL_TO` (weekly-review email via Brevo SMTP; alternates `SMTP_SERVER`/`SMTP_USERNAME`/`SMPT_USERNAME`/`SMTP_PASSWORD` also read; email skipped when unset), `DEEP_RUNS_ENABLED` (default false — MAJOR signals enqueue multi-agent deep runs instead of the inline single pass), `PERSONAS` (enabled investor personas — comma list of names or a number = first N, default all 12), `WORKER_POLL_SEC` (worker idle poll, default 10), `WORKER_MAX_ATTEMPTS` (job retries, default 3), `CONSENSUS_MIN_PERSONAS` (default half of enabled), `DEEP_RUN_STALE_MIN` (requeue stuck running jobs on worker start, default 120)
- Tickers are stored everywhere as the yahoo symbol (`BBCA.JK`, `^JKSE` for IHSG) via `normalizeTicker` — snapshots, analyses, positions, transactions, watchlist, news, dividends (migration `024_ticker_yahoo_symbol.sql`; future-proofs non-IDX markets). UI/Telegram strip the suffix for display via `displayTicker`; URLs carry the plain code
- All timestamps stored UTC, displayed in WIB (Asia/Jakarta, UTC+7)
- All local TypeScript imports use `.js` extension (NodeNext ESM)

## Conventions

- Snake_case for DB column names; camelCase for TypeScript variables
- Section separators: `// ── SECTION NAME ──`
- All code, comments, prompts, and user-facing strings in English (the Google News search query keeps the Indonesian term `saham` to fetch local-market news)
- Telegram messages use HTML formatting, not Markdown
- P&L status emoji: 🟢 PROFIT, ⚪ BREAKEVEN, 🟡 SMALL LOSS, 🔴 LOSS
- All persistent data lives in Supabase (no local JSON/SQLite source of truth)
- Web CRUD (every add/edit) opens a centered modal dialog via `web/components/Modal.tsx`, never an inline form between rows (see `knowledge/design.md` → Components → Dialogs)
- Migrations are tracked in `public.schema_migrations` (version, name, applied_at). Every new file in `supabase/migrations/` **must end** with `insert into public.schema_migrations (version, name) values ('NNN', 'NNN_name') on conflict do nothing;` so `select version from public.schema_migrations order by version` reflects what's live. Migrations are applied manually (psql / Supabase SQL editor), in numeric order; there is no runner.

## Security

- Docker runs as non-root (`appuser`)
- Never expose internal errors/stack traces to users — log internally, show generic message
- All ticker inputs validated with regex `^[A-Z0-9]{1,10}$`
- Supabase RLS: anon denied; authenticated reads all + writes portfolio/watchlist; service role (backend) bypasses RLS
- Secrets via `.env` only, never hardcoded; `SUPABASE_SERVICE_KEY` is backend-only, never in the frontend

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
