# Folionix

> A system for your portfolio.

Self-hosted wealth command center — IDX stocks, gold, mutual funds, and bonds in one place. Watches the market continuously, runs local LLM analysis, sends Telegram alerts, and serves a Next.js dashboard. Your server, your data.

![Node](https://img.shields.io/badge/node-22+-5fa04e?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5-3178c6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/docker-compose-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-green)

---

## What It Does

A unified wealth tracker across four asset classes — IDX stocks, gold, mutual funds, and bonds — with LLM-powered analysis for stocks and a clean dashboard for everything.

```
  yahoo-finance2  ──┐
   Cermati (gold) ──┼──▶ Supabase ──▶ Ollama ──▶ Telegram alerts
   Cermati (funds)──┤              └──▶ Next.js dashboard
     KSEI (bonds) ──┘
```

**Stocks (IDX)**
- Fetches real-time prices via yahoo-finance2, Finnhub fallback
- Runs per-position LLM analysis (Ollama) with news sentiment context
- Sends Telegram alerts: BUY / HOLD / MONITOR / CUT LOSS
- Tracks watchlist with BUY NOW / WAIT / AVOID verdicts
- Signal-aware LangGraph orchestrator monitors during market hours
- Optional multi-agent deep runs on major signals: deterministic analyst scores + up to 12 LLM investor personas (Buffett, Burry, …) voting into a weighted consensus, processed async via a Supabase job queue

**Gold**
- Tracks purchases per venue (Cermati GraphQL)
- Values holdings at venue sell-back price (not buy price)
- Bot commands: `/gadd`, `/glist`, `/gremove`, `/gprice`

**Mutual Funds**
- Sweeps Cermati NAV feed — no per-fund calls needed
- Values holdings at latest NAV per unit
- `fund_catalog` powers web autocomplete for adding positions

**Bonds (Retail: SR / ORI / SBR / ST)**
- Valued at par/principal — no price feed
- KSEI coupon schedule sync
- Tracks days to maturity

**Dashboard**
- Next.js 16 + Tailwind — Portfolio, Watchlist, News, Gold, Funds, Bonds
- All CRUD via centered modal dialogs; reads/writes Supabase directly under Auth + RLS

## Quick Start

### Prerequisites

- Node 22+ (both backend and frontend)
- [Ollama](https://ollama.ai) running locally with a model (default: `qwen2.5:7b`)
- Telegram bot token ([create one](https://core.telegram.org/bots#botfather))
- A **self-hosted Supabase** stack — see the [Supabase foundation runbook](knowledge/runbooks/supabase-foundation.md) for bootstrap steps

### 1. Clone & Configure

```bash
git clone https://github.com/Marvello/Folionix.git
cd Folionix
cp .env.example .env
# Edit .env: SUPABASE_URL/SUPABASE_SERVICE_KEY (backend),
# NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY (web),
# LLM_BACKEND/LLM_MODEL/LLM_API_BASE, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
```

### 2. Stand Up Supabase

Bootstrap a self-hosted Supabase stack, apply `supabase/schema.sql` (+ `migrations/`),
enable Auth, and create your single user. Optionally pre-load `supabase/seed.sql`
for starter positions and watchlist.

### 3. Set Up Portfolio

Positions and watchlist live in Supabase (the source of truth) — add them via the
Telegram bot (`/add BBCA 9500 10`, `/wadd TLKM`) or the web UI.

> **Note:** 1 lot = 100 shares. Tickers use IDX codes without `.JK` suffix.

### 4. Run

**With Docker (recommended)** — Supabase stack must already be up:

```bash
docker compose -f docker/docker-compose.yml up -d
```

**Without Docker:**

```bash
# Backend
cd app && npm install

npm run portfolio     # full portfolio analysis + Telegram alerts
npm run prices        # price-only refresh (no LLM)
npm run prices -- BBCA TLKM  # specific tickers
npm run watchlist     # watchlist analysis
npm run bot           # Telegram bot (long-polling)
npm run graph         # LangGraph orchestrator (long-running, signal-aware)
npm run worker        # multi-agent analysis worker (drains analysis_jobs)

# Frontend
cd web && npm install && npm run dev    # http://localhost:3000
```

## Project Structure

```
app/                        # Node 22 TypeScript backend (ESM, esbuild)
├── src/
│   ├── db/db.ts            # Supabase data layer
│   ├── providers/          # market.ts (yahoo-finance2), finnhub.ts, cermati.ts, ksei.ts
│   ├── ai/                 # llm.ts (Vercel AI SDK), prompts.ts, scores.ts, personas.ts, consensus.ts
│   ├── services/           # portfolio.ts, news.ts, watchlist.ts, gold.ts, funds.ts, bonds.ts
│   ├── telegram/           # client.ts, alerts.ts
│   ├── bot/bot.ts          # grammy Telegram bot (14 commands)
│   └── graph/              # LangGraph orchestrator (state/session/signals/analysis/orchestrator/runner) + worker.ts (deep-run queue)
lib/                        # Shared TypeScript (app/ + web/)
├── types.ts                # Supabase row interfaces
└── format.ts               # Shared helpers (fmtIdr, calcPnl, normalizeTicker, …)
web/                        # Next.js + Tailwind frontend (App Router)
├── app/                    # routes: /, /portfolio, /watchlist, /news, /gold, /funds, /bonds, /login
├── components/             # Nav, MetricCard, RecommendationBadge, modals
└── lib/                    # format.ts, types.ts, supabase/{client,server}.ts
supabase/                   # Schema, migrations, seed, key-gen tool
docker/                     # Dockerfile.app, Dockerfile.web, docker-compose.yml
```

## Docker Services

| Service | Purpose | Port |
|---------|---------|------|
| `folionix-graph` | LangGraph orchestrator (session-aware, signal-driven) | — |
| `folionix-bot` | Telegram bot (long-polling) | — |
| `folionix-worker` | Multi-agent analysis worker (drains `analysis_jobs`) | — |
| `folionix-web` | Next.js + Tailwind dashboard | 3000 |

`folionix-bot`/`folionix-graph`/`folionix-worker` use `marvellooni/folionix-app:latest`; `folionix-web` uses `marvellooni/folionix-web:latest`.
`NEXT_PUBLIC_*` env vars are read at runtime (injected via `window.__ENV`) — the image is environment-agnostic.
Self-hosted Supabase runs as a **separate stack not part of this repo**. Containers run as non-root.

Pin a specific deploy with `FOLIONIX_TAG=<sha8> docker compose -f docker/docker-compose.yml up -d`.

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/status` | Current portfolio P&L summary |
| `/detail BBCA` | Detailed analysis for a ticker |
| `/add BBCA 9500 10` | Add new position (ticker, avg price, lots) |
| `/update BBCA 9200 15` | Update existing position |
| `/remove BBCA` | Deactivate position |
| `/analyze BBCA` | Trigger on-demand LLM analysis |
| `/portfolio` | Export portfolio as JSON |
| `/accuracy` | Recommendation backtest results |
| `/wadd TLKM [notes]` | Add ticker to watchlist |
| `/wremove TLKM` | Remove ticker from watchlist |
| `/wlist` | Show current watchlist |
| `/gadd` · `/glist` · `/gremove` · `/gprice` | Gold position management |
| `/flist` | List fund holdings (read-only) |
| `/blist` | List bond holdings (read-only) |

## Configuration

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Backend Supabase (service key, never in frontend) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web UI Supabase (browser-reachable) |
| `LLM_BACKEND` | `ollama` or `litellm` |
| `LLM_MODEL` | LLM model name (e.g. `qwen2.5:7b`) |
| `LLM_API_BASE` | LLM API endpoint |
| `LLM_API_KEY` | LLM API key (if required) |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` | Bot token and allowed chat ID whitelist |
| `SEND_TELEGRAM` | `true`/`false` — enable/disable Telegram alerts |
| `CACHE_MINUTES` | Skip re-fetch if data is fresh (default: `30`) |
| `ACTION_THRESHOLD_IDR` | Min P&L (Rp) to trigger action recommendation |
| `FINNHUB_API_KEY` | Optional; enables Finnhub fallback when yahoo-finance2 fails |
| `CERMATI_GRAPHQL_URL` | Cermati gold-price GraphQL endpoint |
| `CERMATI_MF_URL` | Cermati mutual-fund products REST endpoint |
| `SIGNAL_PRICE_MINOR` / `SIGNAL_PRICE_MAJOR` | Price move % thresholds (default: `3.0` / `5.0`) |
| `SIGNAL_VOLUME_MINOR` / `SIGNAL_VOLUME_MAJOR` | Volume ratio thresholds (default: `1.5` / `3.0`) |
| `SIGNAL_COOLDOWN_MIN` | Minutes before re-analyzing same ticker (default: `15`) |
| `GRAPH_ACTIVE_INTERVAL` / `GRAPH_IDLE_INTERVAL` | Orchestrator check intervals in seconds |
| `DEEP_RUNS_ENABLED` | `true` routes MAJOR signals to multi-agent deep runs (default: `false`) |
| `PERSONAS` | Enabled investor personas — comma list of names or a number = first N (default: all 12) |
| `WORKER_POLL_SEC` / `WORKER_MAX_ATTEMPTS` | Worker idle poll seconds / job retry cap (default: `10` / `3`) |
| `CONSENSUS_MIN_PERSONAS` | Min persona results before consensus (default: half of enabled) |
| `DEEP_RUN_STALE_MIN` | Requeue jobs stuck `running` longer than this on worker start (default: `120`) |

## Monitoring Schedule

The LangGraph orchestrator (`folionix-graph`) replaces cron with adaptive, signal-aware scheduling:

| Session (WIB) | Behavior |
|---------------|----------|
| 08:45–09:00 (Pre-market) | Signal check, prepare ticker list |
| 09:00–11:30 (Session 1) | Active monitoring, signal detection |
| 11:30–13:30 (Lunch) | Signal check only; major signals trigger immediate analysis |
| 13:30–15:00 (Session 2) | Active monitoring, signal detection |
| 15:00–15:30 (After hours) | Final analysis pass |
| 15:30–08:45 (Closed) | No analysis |

**Signal-driven:** Price moves >3% or volume spikes >1.5x trigger additional analysis. Major signals (>5% price, >3x volume) trigger immediate analysis regardless of schedule — and, with `DEEP_RUNS_ENABLED=true`, enqueue a multi-agent deep run (deterministic analyst scores → persona votes → weighted consensus) drained asynchronously by `folionix-worker`.

## Tech Stack

- **Data:** yahoo-finance2 (primary), Finnhub (fallback), Cermati (gold + funds), KSEI (bond coupons)
- **LLM:** Vercel AI SDK — Ollama or LiteLLM backend (any model)
- **Orchestration:** @langchain/langgraph (session-aware, signal-driven)
- **Database:** self-hosted Supabase (Postgres + PostgREST) via @supabase/supabase-js
- **Bot:** grammy (Telegram, long-polling)
- **UI:** Next.js 16 + Tailwind (`web/`)
- **CI/CD:** GitHub Actions → Docker Hub (multi-arch: amd64 + arm64)

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE): free to use, modify, and share for any **noncommercial** purpose. **Commercial use requires a separate paid license** — contact me@marvello.xyz.
