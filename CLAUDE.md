# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Indonesian stock portfolio (IDX) analyzer. Fetches market data via yfinance, runs LLM analysis via Ollama, sends alerts to Telegram, and provides a Streamlit dashboard. Python 3.11+.

## Project Structure

```
app/                        # Main application code
├── __init__.py
├── fetch_portfolio.py      # Data pipeline (yfinance → Ollama → Telegram)
├── analyze_watchlist.py    # Watchlist analysis pipeline
├── bot.py                  # Telegram bot (long-polling)
├── db.py                   # SQLAlchemy Core database layer
├── ui.py                   # Streamlit dashboard
├── utils.py                # Shared helpers
├── watchlist.py            # Watchlist business logic (shared by bot + UI)
├── graph/                  # LangGraph orchestrator
│   ├── __init__.py         # Package exports
│   ├── state.py            # TypedDict state schemas + enums
│   ├── session.py          # IDX market session detection (WIB time)
│   ├── signals.py          # Signal detection (price move, volume spike)
│   ├── analysis.py         # Inner graph: analysis pipeline per ticker
│   ├── orchestrator.py     # Outer graph: session + signal routing
│   └── runner.py           # Long-running entry point (SIGTERM-aware)
docker/                     # Docker-related files
├── Dockerfile
├── docker-compose.yml
├── crontab
data/                       # Runtime data (gitignored except json/)
├── app.db                  # SQLite database (gitignored)
├── json/
│   ├── portfolio.json      # Stock positions (tracked)
│   └── watchlist.json      # Watchlist tickers (tracked)
tests/                      # pytest test suite
```

## Running Locally

```bash
# Setup
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run full analysis
python -m app.fetch_portfolio

# Specific tickers only
python -m app.fetch_portfolio BBCA BBRI

# Skip Telegram / skip LLM
python -m app.fetch_portfolio --no-telegram
python -m app.fetch_portfolio --no-llm

# Telegram bot
python -m app.bot

# Streamlit dashboard
streamlit run app/ui.py --server.port 8501

# Watchlist analysis
python -m app.analyze_watchlist

# LangGraph orchestrator (long-running, replaces cron)
python -m app.graph.runner

# Tests
pytest tests/ -v
```

## Docker

Four services in `docker/docker-compose.yml`: `idx-cron` (supercronic), `idx-bot` (Telegram), `idx-ui` (Streamlit on 8501), `idx-graph` (LangGraph orchestrator). All share `.env` and `data/` volume.

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f idx-cron
```

Containers reach host Ollama via `extra_hosts: debian-tower:host-gateway`.
CI/CD: GitHub Actions builds and pushes image to `ghcr.io/marvello/my-stocks:latest` on every push to main.

## Architecture

```
app/fetch_portfolio.py  →  yfinance → Ollama LLM → Telegram alerts
app/analyze_watchlist.py →  yfinance → Ollama LLM → Telegram alerts
app/graph/runner.py     →  LangGraph orchestrator (session-aware, signal-driven)
       ↓ (saves)
     app/db.py  ←→  SQLite (data/app.db) / PostgreSQL
       ↑ (reads)
     app/bot.py  ←→  Telegram commands (/status, /add, /update, /remove, /analyze, /wadd, /wremove, /wlist)
     app/ui.py   ←→  Streamlit dashboard (Dashboard + portfolio CRUD, Watchlist + watchlist CRUD, History, Analysis Log, Accuracy)
```

- **app/fetch_portfolio.py**: Data pipeline. Fetches stock prices, builds Indonesian-language LLM prompts (with `depth` parameter: LIGHT/FULL/DEEP), calls Ollama `/api/chat`, cleans HTML output, saves snapshots + analyses to DB, sends Telegram alerts.
- **app/analyze_watchlist.py**: Same pipeline for watchlist tickers (not owned). Produces BUY SEKARANG / TUNGGU / HINDARI verdicts.
- **app/db.py**: SQLAlchemy Core (not ORM). Tables: `stock_snapshots`, `llm_analyses`, `portfolio_positions`. SQLite default with WAL mode, PostgreSQL-ready.
- **app/bot.py**: Telegram long-polling with chat ID whitelisting. /add only adds new, /update only modifies existing. Watchlist commands: /wadd TICKER [notes] — add ticker to watchlist; /wremove TICKER — remove ticker from watchlist; /wlist — show current watchlist.
- **app/ui.py**: Streamlit multi-page: Dashboard (+ portfolio CRUD), Watchlist (+ watchlist CRUD), History, Analysis Log, Accuracy.
- **app/watchlist.py**: Shared watchlist business logic (add, remove, list, AI suggest) used by both bot and UI.
- **app/utils.py**: Shared helpers (formatting, timezone, version, atomic JSON writes, JSON schema validation).
- **app/graph/**: LangGraph orchestrator. Two graphs: outer orchestrator (session detection → signal monitoring → routing) and inner analysis pipeline (fan-out per ticker → fetch → LLM → save → alert). Wraps existing pipeline functions as thin graph nodes. Runs as long-running process with SIGTERM handling. Replaces cron scheduling with signal-aware, market-session-aware monitoring (5-min intervals during market hours, 30-min idle).

## Key Configuration

- **data/json/portfolio.json**: Source of truth for stock positions (ticker, avg_price, lots, active, notes). 1 lot = 100 shares.
- **data/json/watchlist.json**: Watchlist tickers (user-added and AI-suggested). Mutually exclusive with portfolio.
- **.env**: `OLLAMA_URL`, `OLLAMA_MODEL`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `CACHE_MINUTES`, `ACTION_THRESHOLD_IDR`, `SEND_TELEGRAM`, `SIGNAL_PRICE_MINOR`, `SIGNAL_PRICE_MAJOR`, `SIGNAL_VOLUME_MINOR`, `SIGNAL_VOLUME_MAJOR`, `SIGNAL_COOLDOWN_MIN`, `GRAPH_ACTIVE_INTERVAL`, `GRAPH_IDLE_INTERVAL`, `GRAPH_SEND_TELEGRAM`
- IDX tickers auto-append `.JK` suffix for yfinance
- All timestamps stored UTC, displayed in WIB (Asia/Jakarta, UTC+7)
- All imports use `app.` prefix (e.g., `from app.db import init_db`)

## Conventions

- Snake_case throughout
- Type hints use Python 3.10+ union syntax (`dict | None`)
- Section separators: `# ── SECTION NAME ──`
- LLM prompts and some comments in Indonesian (Bahasa)
- Telegram messages use HTML formatting, not Markdown
- P&L status emoji: 🟢 PROFIT, ⚪ BREAKEVEN, 🟡 RUGI TIPIS, 🔴 RUGI
- JSON files written atomically via `write_json_atomic()` in utils
- All persistent data lives under `data/` directory

## Security

- Docker runs as non-root (`appuser`)
- Never expose internal errors/stack traces to users — log internally, show generic message
- All ticker inputs validated with regex `^[A-Z0-9]{1,10}$`
- JSON files validated against schema before use (`validate_portfolio_json`, `validate_watchlist_json`)
- Secrets via `.env` only, never hardcoded
- See `.claude/rules/security.md` for full security standards
