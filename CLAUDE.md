# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Indonesian stock portfolio (IDX) analyzer. Fetches market data via yfinance, runs LLM analysis via Ollama, sends alerts to Telegram, and provides a Streamlit dashboard. Python 3.11+, no test suite or linter configured.

## Running Locally

```bash
# Setup
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run full analysis (fetches all positions, calls Ollama, sends Telegram)
python fetch_portfolio.py

# Specific tickers only
python fetch_portfolio.py BBCA BBRI

# Skip Telegram / skip LLM
python fetch_portfolio.py --no-telegram
python fetch_portfolio.py --no-llm

# Telegram bot (long-polling listener)
python bot.py

# Streamlit dashboard
streamlit run ui.py --server.port 8501
```

## Docker

Three services in `docker-compose.yml`: `idx-cron` (scheduled fetch via supercronic), `idx-bot` (Telegram), `idx-ui` (Streamlit on port 8501). All share `.env`, `portfolio.json`, and `data/` volume.

```bash
docker compose up -d --build
docker compose logs -f idx-cron
```

Containers reach host Ollama via `extra_hosts: debian-tower:host-gateway`.

## Architecture

```
fetch_portfolio.py  →  yfinance → Ollama LLM → Telegram alerts
       ↓ (saves)
     db.py  ←→  SQLite (default) / PostgreSQL
       ↑ (reads)
     bot.py  ←→  Telegram commands (/status, /add, /update, /remove, /analyze)
     ui.py   ←→  Streamlit dashboard (Dashboard, Positions, History, Analysis Log)
```

- **fetch_portfolio.py** (main): Data pipeline. Fetches stock prices, builds Indonesian-language LLM prompts, calls Ollama `/api/chat`, cleans HTML output, saves snapshots + analyses to DB, sends Telegram alerts. Has rate-limit jitter (3-6s between tickers) and 30-min snapshot caching.
- **db.py**: SQLAlchemy Core (not ORM). Tables: `stock_snapshots`, `llm_analyses` (FK to snapshots), `portfolio_positions`. SQLite default, PostgreSQL-ready.
- **bot.py**: Telegram long-polling with chat ID whitelisting. Manages portfolio.json + DB positions. Chunks messages at 4096 chars.
- **ui.py**: Streamlit multi-page app with position CRUD, charts, and analysis history.

## Key Configuration

- **portfolio.json**: Source of truth for stock positions (ticker, avg_price, lots, active, notes). 1 lot = 100 shares.
- **.env**: `OLLAMA_URL`, `OLLAMA_MODEL`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `CACHE_MINUTES`, `ACTION_THRESHOLD_IDR`, `SEND_TELEGRAM`
- IDX tickers auto-append `.JK` suffix for yfinance
- All timestamps stored UTC, displayed in WIB (Asia/Jakarta, UTC+7)

## Conventions

- Snake_case throughout
- Type hints use Python 3.10+ union syntax (`dict | None`)
- Section separators: `# ── SECTION NAME ──`
- LLM prompts and some comments in Indonesian (Bahasa)
- Telegram messages use HTML formatting, not Markdown
- P&L status emoji: 🟢 PROFIT, ⚪ BREAKEVEN, 🟡 RUGI TIPIS, 🔴 RUGI
