# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Indonesian stock portfolio (IDX) analyzer. Fetches market data via yfinance, runs LLM analysis via Ollama, sends alerts to Telegram, and provides a Streamlit dashboard. Python 3.11+.

## Project Structure

```
app/                        # Main application code
├── __init__.py
├── fetch_portfolio.py      # Data pipeline (yfinance → Ollama → Telegram)
├── db.py                   # SQLAlchemy Core database layer
├── bot.py                  # Telegram bot (long-polling)
├── ui.py                   # Streamlit dashboard
├── utils.py                # Shared helpers
├── analyze_watchlist.py    # Watchlist analysis pipeline
docker/                     # Docker-related files
├── Dockerfile
├── docker-compose.yml
├── crontab
scripts/                    # Utility scripts
├── watchlist_manager.py    # CLI: add/remove/suggest watchlist tickers
data/                       # Runtime data (gitignored)
├── app.db                  # SQLite database
├── json/
│   ├── portfolio.json      # Stock positions
│   └── watchlist.json      # Watchlist tickers
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

# Watchlist management
python scripts/watchlist_manager.py add TLKM "Defensive telco"
python scripts/watchlist_manager.py suggest
python -m app.analyze_watchlist
```

## Docker

Three services in `docker/docker-compose.yml`: `idx-cron` (scheduled fetch via supercronic), `idx-bot` (Telegram), `idx-ui` (Streamlit on port 8501). All share `.env` and `data/` volume.

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
       ↓ (saves)
     app/db.py  ←→  SQLite (data/app.db) / PostgreSQL
       ↑ (reads)
     app/bot.py  ←→  Telegram commands (/status, /add, /update, /remove, /analyze)
     app/ui.py   ←→  Streamlit dashboard (Dashboard, Watchlist, Positions, History, Analysis Log, Accuracy)
```

- **app/fetch_portfolio.py**: Data pipeline. Fetches stock prices, builds Indonesian-language LLM prompts, calls Ollama `/api/chat`, cleans HTML output, saves snapshots + analyses to DB, sends Telegram alerts.
- **app/analyze_watchlist.py**: Same pipeline for watchlist tickers (not owned). Produces BUY SEKARANG / TUNGGU / HINDARI verdicts.
- **app/db.py**: SQLAlchemy Core (not ORM). Tables: `stock_snapshots`, `llm_analyses`, `portfolio_positions`. SQLite default with WAL mode, PostgreSQL-ready.
- **app/bot.py**: Telegram long-polling with chat ID whitelisting. /add only adds new, /update only modifies existing.
- **app/ui.py**: Streamlit multi-page app: Dashboard, Watchlist, Positions, History, Analysis Log, Accuracy.
- **app/utils.py**: Shared helpers (formatting, timezone, version, atomic JSON writes).

## Key Configuration

- **data/json/portfolio.json**: Source of truth for stock positions (ticker, avg_price, lots, active, notes). 1 lot = 100 shares.
- **data/json/watchlist.json**: Watchlist tickers (user-added and AI-suggested). Mutually exclusive with portfolio.
- **.env**: `OLLAMA_URL`, `OLLAMA_MODEL`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `CACHE_MINUTES`, `ACTION_THRESHOLD_IDR`, `SEND_TELEGRAM`
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
