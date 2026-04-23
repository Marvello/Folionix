# 📈 IDX Portfolio Analyzer

Automated Indonesian stock portfolio tracker with LLM-powered analysis, Telegram alerts, and a real-time dashboard.

![Python](https://img.shields.io/badge/python-3.11+-3776ab?logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/docker-compose-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-CC--BY--NC--4.0-green)

---

## What It Does

```
┌─────────────┐     ┌──────────┐     ┌─────────┐     ┌──────────────┐
│   yfinance  │────▶│  Ollama  │────▶│ Telegram│     │  Streamlit   │
│  (IDX data) │     │  (LLM)   │     │  alerts │     │  dashboard   │
└─────────────┘     └──────────┘     └─────────┘     └──────────────┘
       │                 │                                  │
       └─────────────────┴──────────┬───────────────────────┘
                                    ▼
                             ┌─────────────┐
                             │   SQLite DB │
                             └─────────────┘
```

- **Fetches** real-time IDX stock prices via Yahoo Finance
- **Analyzes** each position using a local LLM (Ollama) with Indonesian-language prompts
- **Alerts** via Telegram with actionable recommendations (BUY, HOLD, MONITOR, CUT LOSS, etc.)
- **Watches** potential stocks via AI-powered watchlist with BUY SEKARANG / TUNGGU / HINDARI verdicts
- **Tracks** price history, P&L, and recommendation accuracy over time
- **Displays** everything in a Streamlit dashboard — Dashboard (+ portfolio CRUD), Watchlist (+ watchlist CRUD), History, Analysis Log, Accuracy

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
├── watchlist.py            # Watchlist business logic (shared by bot + UI)
├── graph/                  # LangGraph orchestrator
│   ├── state.py            # State schemas + enums
│   ├── session.py          # Market session detection
│   ├── signals.py          # Signal detection (price/volume)
│   ├── analysis.py         # Analysis pipeline graph
│   ├── orchestrator.py     # Session + signal routing graph
│   └── runner.py           # Long-running entry point
docker/                     # Docker config
├── Dockerfile              # Multi-service image
├── docker-compose.yml      # 3 services (bot, ui, graph)
data/json/                  # Tracked data files
├── portfolio.json          # Stock positions
├── watchlist.json          # Watchlist tickers
tests/                      # Test suite
```

## Docker Services

| Service | Purpose | Port |
|---------|---------|------|
| `idx-graph` | LangGraph orchestrator (session-aware, signal-driven analysis) | — |
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

# Watchlist analysis
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
| `/wadd TLKM [notes]` | Add ticker to watchlist |
| `/wremove TLKM` | Remove ticker from watchlist |
| `/wlist` | Show current watchlist |

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
| `SIGNAL_PRICE_MINOR` | `3.0` | Price move % to trigger minor signal |
| `SIGNAL_PRICE_MAJOR` | `5.0` | Price move % to trigger major signal |
| `SIGNAL_VOLUME_MINOR` | `1.5` | Volume ratio for minor signal |
| `SIGNAL_VOLUME_MAJOR` | `3.0` | Volume ratio for major signal |
| `SIGNAL_COOLDOWN_MIN` | `15` | Minutes before re-analyzing same ticker |
| `GRAPH_ACTIVE_INTERVAL` | `300` | Check interval (s) during market hours |
| `GRAPH_IDLE_INTERVAL` | `1800` | Check interval (s) when market closed |
| `GRAPH_SEND_TELEGRAM` | `true` | Enable Telegram in graph orchestrator |

## Monitoring Schedule

The LangGraph orchestrator (`idx-graph`) replaces cron with adaptive, signal-aware scheduling:

| Session (WIB) | Interval | Behavior |
|---------------|----------|----------|
| 08:45–09:00 (Pre-market) | 15 min | Signal check, prepare ticker list |
| 09:00–11:30 (Session 1) | 5 min | Active monitoring, signal detection |
| 11:30–13:30 (Lunch) | 15 min | Signal check only, major signals trigger immediate analysis |
| 13:30–15:00 (Session 2) | 5 min | Active monitoring, signal detection |
| 15:00–15:30 (After hours) | 30 min | Deep fundamental analysis |
| 15:30–08:45 (Closed) | 30 min | No analysis |

**Signal-driven analysis:** Price moves >3% or volume spikes >1.5x trigger additional analysis. Major signals (>5% price, >3x volume) trigger immediate analysis regardless of schedule.

## Tech Stack

- **Data:** yfinance, pandas
- **LLM:** Ollama (local, any model — qwen2.5:7b, gemma4)
- **Orchestration:** LangGraph (session-aware, signal-driven)
- **Database:** SQLAlchemy Core → SQLite (PostgreSQL-ready)
- **Bot:** Telegram Bot API (raw HTTP, no framework)
- **UI:** Streamlit
- **Scheduler:** supercronic (in Docker), LangGraph orchestrator
- **CI/CD:** GitHub Actions → GHCR

## License

This project is licensed under [CC BY-NC 4.0](LICENSE) — free to use, modify, and share for non-commercial purposes.
