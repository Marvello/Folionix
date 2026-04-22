# 📈 IDX Portfolio Analyzer

Automated Indonesian stock portfolio tracker with LLM-powered analysis, Telegram alerts, and a real-time dashboard.

![Python](https://img.shields.io/badge/python-3.11+-3776ab?logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/docker-compose-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-CC--BY--NC--4.0-green)

---

## What It Does

```
┌─────────────┐     ┌──────────┐     ┌─────────┐     ┌──────────────┐
│   yfinance   │────▶│  Ollama  │────▶│ Telegram │     │  Streamlit   │
│  (IDX data)  │     │  (LLM)   │     │  alerts  │     │  dashboard   │
└─────────────┘     └──────────┘     └─────────┘     └──────────────┘
       │                  │                                   │
       └──────────────────┴───────────┬───────────────────────┘
                                      ▼
                               ┌─────────────┐
                               │   SQLite DB  │
                               └─────────────┘
```

- **Fetches** real-time IDX stock prices via Yahoo Finance
- **Analyzes** each position using a local LLM (Ollama) with Indonesian-language prompts
- **Alerts** via Telegram with actionable recommendations (BUY, HOLD, MONITOR, CUT LOSS, etc.)
- **Watches** potential stocks via AI-powered watchlist with BUY SEKARANG / TUNGGU / HINDARI verdicts
- **Tracks** price history, P&L, and recommendation accuracy over time
- **Displays** everything in a Streamlit dashboard with portfolio CRUD

## Screenshots

| Dashboard | Telegram Alert |
|-----------|----------------|
| Portfolio overview with P&L, charts, and recommendations | Per-stock LLM analysis with color-coded actions |

## Quick Start

### Prerequisites

- Python 3.11+
- [Ollama](https://ollama.ai) running locally with a model (default: `qwen2.5:7b`)
- Telegram bot token ([create one](https://core.telegram.org/bots#botfather))

### 1. Clone & Configure

```bash
git clone https://github.com/Marvello/my-stocks.git
cd my-stocks
cp .env.example .env
# Edit .env with your Ollama URL, Telegram token, and chat ID
```

### 2. Set Up Portfolio

Edit `data/json/portfolio.json` with your positions:

```json
{
  "positions": [
    { "ticker": "BBCA", "avg_price": 9500, "lots": 10, "active": true, "notes": "Blue chip banking" },
    { "ticker": "TLKM", "avg_price": 3800, "lots": 20, "active": true, "notes": "" }
  ]
}
```

> **Note:** 1 lot = 100 shares. Tickers use IDX codes without `.JK` suffix.

### 3. Run

**With Docker (recommended):**

```bash
docker compose -f docker/docker-compose.yml pull
docker compose -f docker/docker-compose.yml up -d
```

**Without Docker:**

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run full analysis
python -m app.fetch_portfolio

# Start Telegram bot
python -m app.bot

# Start dashboard
streamlit run app/ui.py --server.port 8501
```

## Project Structure

```
app/                        # Application code
├── fetch_portfolio.py      # Main data pipeline
├── analyze_watchlist.py    # Watchlist analysis pipeline
├── bot.py                  # Telegram bot
├── db.py                   # Database layer (SQLAlchemy Core)
├── ui.py                   # Streamlit dashboard
├── utils.py                # Shared helpers
docker/                     # Docker config
├── Dockerfile              # Multi-service image
├── docker-compose.yml      # 3 services (cron, bot, ui)
├── crontab                 # Supercronic schedule
scripts/                    # Utility scripts
├── watchlist_manager.py    # Watchlist CLI
data/json/                  # Tracked data files
├── portfolio.json          # Stock positions
├── watchlist.json          # Watchlist tickers
tests/                      # Test suite
```

## Docker Services

| Service | Purpose | Port |
|---------|---------|------|
| `idx-cron` | Scheduled fetcher + watchlist (weekdays, IDX market hours) | — |
| `idx-bot` | Telegram bot (long-polling) | — |
| `idx-ui` | Streamlit dashboard | 8501 |

All services share the same image (`ghcr.io/marvello/my-stocks:latest`), `.env` config, and `data/` volume. Container runs as non-root user.

## CLI Options

```bash
# Analyze specific tickers only
python -m app.fetch_portfolio BBCA BBRI

# Skip Telegram notifications
python -m app.fetch_portfolio --no-telegram

# Skip LLM analysis (data fetch only)
python -m app.fetch_portfolio --no-llm

# Watchlist management
python scripts/watchlist_manager.py add TLKM "Defensive telco"
python scripts/watchlist_manager.py remove TLKM
python scripts/watchlist_manager.py suggest    # AI suggestions
python scripts/watchlist_manager.py list

# Run watchlist analysis
python -m app.analyze_watchlist
```

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

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen2.5:7b` | LLM model for analysis |
| `TELEGRAM_TOKEN` | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Allowed chat ID (whitelist) |
| `SEND_TELEGRAM` | `true` | Enable/disable Telegram alerts |
| `CACHE_MINUTES` | `30` | Skip re-fetch if data is fresh |
| `ACTION_THRESHOLD_IDR` | `1000000` | Min P&L (Rp) to trigger action recommendation |
| `DATABASE_URL` | `sqlite:///./data/app.db` | DB connection string |
| `UI_PASSWORD` | — | Optional Streamlit login password |

## Cron Schedule (IDX Market Hours)

**Portfolio analysis:**
```
Session 1:  09:05, 10:05, 11:05, 12:05 WIB (Mon-Fri)
Session 2:  13:35, 14:35 WIB (Mon-Fri)
Close:      15:05 WIB (Mon-Fri)
```

**Watchlist analysis:**
```
08:30, 15:30 WIB (Mon-Fri)
```

## Tech Stack

- **Data:** yfinance, pandas
- **LLM:** Ollama (local, any model)
- **Database:** SQLAlchemy Core → SQLite (PostgreSQL-ready)
- **Bot:** Telegram Bot API (raw HTTP, no framework)
- **UI:** Streamlit
- **Scheduler:** supercronic (in Docker)
- **CI/CD:** GitHub Actions → GHCR

## License

This project is licensed under [CC BY-NC 4.0](LICENSE) — free to use, modify, and share for non-commercial purposes.
