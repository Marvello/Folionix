# LangGraph Orchestrator — Design Spec

## Overview

Two separate LangGraph graphs wrapping existing pipeline functions. Session-aware orchestrator detects market signals and routes to analysis pipeline with appropriate depth. Runs as long-running Docker service.

## Architecture

### Graph Structure

**Outer graph — Orchestrator (`orchestrator.py`):**

```
START → detect_session → check_signals → route
  ├── SKIP (lunch/closed, no signals) → sleep → START
  ├── BATCH (minor signals or scheduled run) → run_analysis_graph(flagged tickers) → sleep → START
  └── IMMEDIATE (major signals) → run_analysis_graph(triggered tickers) → sleep → START
```

**Inner graph — Analysis Pipeline (`analysis.py`):**

```
START → fan_out_tickers → [per ticker: fetch → decide_depth → build_prompt → call_ollama → clean → extract → save] → aggregate → send_telegram → END
```

### File Structure

```
app/graph/
├── __init__.py
├── runner.py           # Long-running process entry point
├── orchestrator.py     # Outer graph: session state + signal monitor loop
├── analysis.py         # Inner graph: analysis pipeline (fan-out per ticker)
├── signals.py          # Signal detection logic
└── state.py            # State schemas
```

## State Schemas

### Orchestrator State

```python
class OrchestratorState(TypedDict):
    current_session: str          # PRE_MARKET | SESSION_1 | LUNCH | SESSION_2 | AFTER_HOURS | CLOSED
    last_check: datetime
    signals: list[TickerSignal]   # detected signals since last analysis
    pending_batch: list[str]      # tickers queued for next scheduled run
    last_run: dict[str, datetime] # ticker → last analysis time (avoid spam)
```

### TickerSignal

```python
class TickerSignal(TypedDict):
    ticker: str
    signal_type: str        # PRICE_MOVE | VOLUME_SPIKE | COMBINED
    tier: str               # MINOR | MAJOR
    value: float            # actual % move or volume ratio
    detected_at: datetime
```

### Analysis State (inner graph)

```python
class AnalysisState(TypedDict):
    tickers: list[str]
    depth: str                    # LIGHT | FULL | DEEP
    session: str                  # from orchestrator
    results: dict[str, TickerResult]  # ticker → analysis result
    errors: dict[str, str]        # ticker → error message
```

### TickerResult

```python
class TickerResult(TypedDict):
    snapshot_id: int
    recommendation: str
    clean_html: str
    signals: list[TickerSignal]   # what triggered this analysis
    sent: bool
```

## Session Detection

| Time (WIB) | Session | Default behavior |
|------------|---------|-----------------|
| 00:00–08:45 | CLOSED | Sleep 30 min, no analysis |
| 08:45–09:00 | PRE_MARKET | Check signals, prepare ticker list |
| 09:00–11:30 | SESSION_1 | Active monitoring, 5 min interval |
| 11:30–13:30 | LUNCH | Sleep 15 min, signal check only |
| 13:30–15:00 | SESSION_2 | Active monitoring, 5 min interval |
| 15:00–15:30 | AFTER_HOURS | Final deep analysis run |
| 15:30–00:00 | CLOSED | Sleep 30 min, no analysis |

## Signal Detection

Each check cycle fetches latest price + volume for all active tickers via existing `fetch_stock()`, compares against last snapshot in DB.

### Thresholds

| Signal | Minor | Major |
|--------|-------|-------|
| Price move | >3% intraday | >5% intraday |
| Volume spike | >1.5x avg | >3x avg |
| Combined | minor price + minor volume | escalates to MAJOR |

### Routing Logic

- No signals + not scheduled → SKIP
- Minor signals only → add to `pending_batch`, process at next scheduled interval (every 30 min)
- Major signal or combined trigger → IMMEDIATE, analyze now
- Scheduled run (every 30 min during active sessions) → BATCH all active tickers
- Cooldown: no re-analysis of same ticker within 15 min

## Analysis Pipeline Nodes

### 1. fan_out_tickers
- Uses LangGraph `Send()` API for parallel branches per ticker

### 2. fetch_data (wraps `fetch_stock()`)
- Calls existing function unchanged
- Saves snapshot via `save_snapshot()`
- On error: logs, adds to `errors` dict, skips ticker

### 3. decide_depth
- Picks prompt strategy based on signal tier + session:

| Session | Signal | Depth | Behavior |
|---------|--------|-------|----------|
| SESSION_1/2 | MAJOR | FULL | Current `build_prompt()` as-is |
| SESSION_1/2 | MINOR/none | LIGHT | Shorter prompt, skip fundamentals, price action only |
| AFTER_HOURS | any | DEEP | Extended prompt, sector comparison, `num_predict=4096` |
| LUNCH | MAJOR only | FULL | Same as active session |

### 4. build_and_call_llm (wraps `build_prompt()` + `call_ollama()`)
- Calls `build_prompt()` with depth modifier
- Calls `call_ollama()` unchanged
- Retry: once on empty response, once on timeout, then skip

### 5. process_output (wraps `clean_for_telegram()` + `extract_recommendation()`)
- Clean HTML, extract recommendation
- Duplicate suppression (same rec + same day = skip)
- Save via `save_analysis()`

### 6. aggregate
- Collect all ticker results
- Batch runs: one summary + individual analyses
- Immediate runs: individual message only

### 7. send_alerts (wraps existing Telegram send)
- Uses existing `send_telegram()`
- Respects `SEND_TELEGRAM` env flag

## Existing Function Changes

Minimal. Only change needed:

- `build_prompt()` — add `depth` parameter (`LIGHT | FULL | DEEP`) to control prompt length and content blocks included

Everything else called as-is.

## Runner & Docker

### runner.py

```python
def main():
    init_db()
    graph = build_orchestrator_graph()
    state = initial_state()
    while True:
        state = graph.invoke(state)
        sleep_seconds = get_sleep_interval(state["current_session"])
        time.sleep(sleep_seconds)
```

### Docker service

```yaml
idx-graph:
    build: .
    command: python -m app.graph.runner
    env_file: .env
    extra_hosts:
      - "debian-tower:host-gateway"
    volumes:
      - ../data:/data
    restart: unless-stopped
```

### Graceful shutdown

SIGTERM handler saves current state, finishes in-flight analysis, then exits.

## Environment Variables

```
SIGNAL_PRICE_MINOR=3.0
SIGNAL_PRICE_MAJOR=5.0
SIGNAL_VOLUME_MINOR=1.5
SIGNAL_VOLUME_MAJOR=3.0
SIGNAL_COOLDOWN_MIN=15
GRAPH_ACTIVE_INTERVAL=300
GRAPH_IDLE_INTERVAL=1800
```

## New Dependencies

```
langgraph>=0.4.0
langchain-core>=0.3.0
```

No `langchain-community` or `langchain-ollama`. Existing `requests.post()` to Ollama stays. LangGraph used purely for orchestration.

## Migration Path

### Phase 1 — Build alongside existing
- Add `app/graph/` module
- Runner works independently
- Existing cron + `fetch_portfolio.py` unchanged
- Test graph runner manually, compare outputs

### Phase 2 — Run in parallel
- Deploy `idx-graph` Docker service
- Disable Telegram in graph (separate `GRAPH_SEND_TELEGRAM` env var)
- Both systems run, compare results in DB
- Validate signal detection

### Phase 3 — Cutover
- Enable Telegram in graph
- Remove portfolio/watchlist cron entries
- Keep `fetch_portfolio.py` as standalone tool (for `/analyze` command)
- Bot `/analyze` command calls graph instead of subprocess

### Rollback
At any phase: disable `idx-graph` service, re-enable cron entries. No data migration — same DB, same tables.

## Unchanged Components

- `app/db.py` — no schema changes
- `app/bot.py` — Phase 3 only changes `/analyze` handler
- `app/ui.py` — no changes
- `app/utils.py` — no changes
- `data/json/portfolio.json` — same source of truth
