# LangGraph Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LangGraph-based orchestrator that replaces cron-based scheduling with a long-running, signal-aware process that monitors market sessions and triggers analysis at appropriate depth.

**Architecture:** Two LangGraph graphs — an outer orchestrator (session detection + signal monitoring loop) and an inner analysis pipeline (parallel fan-out per ticker). Thin wrapper nodes call existing functions unchanged. Runs as 4th Docker service.

**Tech Stack:** LangGraph >= 0.4.0, langchain-core >= 0.3.0, existing yfinance/requests/SQLAlchemy stack unchanged.

**Spec:** `docs/superpowers/specs/2026-04-23-langgraph-orchestrator-design.md`

---

## File Structure

```
app/graph/
├── __init__.py          # Package init, exports build functions
├── state.py             # TypedDict state schemas (OrchestratorState, AnalysisState, TickerSignal, TickerResult)
├── signals.py           # Signal detection: detect_signals(), classify_tier(), check thresholds
├── session.py           # Session detection: detect_session() based on WIB time
├── analysis.py          # Inner graph: fan-out per ticker, wraps existing pipeline functions
├── orchestrator.py      # Outer graph: session + signals → route → analysis → sleep
├── runner.py            # Long-running entry point with SIGTERM handling
tests/
├── test_session.py      # Session detection tests
├── test_signals.py      # Signal detection + classification tests
├── test_analysis.py     # Analysis pipeline node tests
├── test_orchestrator.py # Orchestrator routing tests
```

**Modified files:**
- `app/fetch_portfolio.py` — add `depth` parameter to `build_prompt()`
- `requirements.txt` — add langgraph, langchain-core
- `docker/docker-compose.yml` — add idx-graph service
- `.env.example` — add signal/graph env vars

---

## Task 1: Add Dependencies

**Files:**
- Modify: `requirements.txt`
- Modify: `.env.example`

- [ ] **Step 1: Add langgraph and langchain-core to requirements.txt**

```python
# Add after existing dependencies, before dev dependencies:
langgraph>=0.4.0
langchain-core>=0.3.0
```

The `requirements.txt` should look like:

```
yfinance==1.3.0
requests>=2.31.0
python-dotenv>=1.0.0
pandas>=2.0.0
numpy>=1.26.0
sqlalchemy>=2.0.0
streamlit>=1.35.0
# psycopg2-binary>=2.9.0  # uncomment for Postgres
langgraph>=0.4.0
langchain-core>=0.3.0

# Dev dependencies
pytest>=9.0.0
ruff>=0.4.0
```

- [ ] **Step 2: Add signal/graph env vars to .env.example**

Append to `.env.example`:

```
# LangGraph orchestrator settings
SIGNAL_PRICE_MINOR=3.0
SIGNAL_PRICE_MAJOR=5.0
SIGNAL_VOLUME_MINOR=1.5
SIGNAL_VOLUME_MAJOR=3.0
SIGNAL_COOLDOWN_MIN=15
GRAPH_ACTIVE_INTERVAL=300
GRAPH_IDLE_INTERVAL=1800
GRAPH_SEND_TELEGRAM=false
```

- [ ] **Step 3: Install and verify**

Run: `pip install langgraph langchain-core`
Expected: installs without errors

Run: `python -c "import langgraph; print(langgraph.__version__)"`
Expected: prints version >= 0.4.0

- [ ] **Step 4: Commit**

```bash
git add requirements.txt .env.example
git commit -m "chore: add langgraph dependencies and graph env vars"
```

---

## Task 2: State Schemas

**Files:**
- Create: `app/graph/__init__.py`
- Create: `app/graph/state.py`
- Test: `tests/test_state.py`

- [ ] **Step 1: Create package init**

Create `app/graph/__init__.py`:

```python
"""LangGraph orchestrator for IDX portfolio analysis."""
```

- [ ] **Step 2: Write failing test for state schemas**

Create `tests/test_state.py`:

```python
from datetime import datetime, timezone

from app.graph.state import (
    OrchestratorState,
    AnalysisState,
    TickerSignal,
    TickerResult,
    Session,
    SignalType,
    SignalTier,
    Depth,
    initial_orchestrator_state,
)


def test_ticker_signal_creation():
    sig = TickerSignal(
        ticker="BBCA",
        signal_type=SignalType.PRICE_MOVE,
        tier=SignalTier.MAJOR,
        value=5.2,
        detected_at=datetime.now(timezone.utc),
    )
    assert sig["ticker"] == "BBCA"
    assert sig["tier"] == SignalTier.MAJOR


def test_ticker_result_creation():
    res = TickerResult(
        snapshot_id=42,
        recommendation="HOLD",
        clean_html="<b>HOLD</b>",
        signals=[],
        sent=True,
    )
    assert res["snapshot_id"] == 42
    assert res["sent"] is True


def test_initial_orchestrator_state():
    state = initial_orchestrator_state()
    assert state["current_session"] == Session.CLOSED
    assert state["signals"] == []
    assert state["pending_batch"] == []
    assert state["last_run"] == {}


def test_analysis_state_creation():
    state = AnalysisState(
        tickers=["BBCA", "BBRI"],
        depth=Depth.FULL,
        session=Session.SESSION_1,
        results={},
        errors={},
    )
    assert len(state["tickers"]) == 2
    assert state["depth"] == Depth.FULL
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_state.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.graph.state'`

- [ ] **Step 4: Implement state schemas**

Create `app/graph/state.py`:

```python
"""State schemas for LangGraph orchestrator."""

from datetime import datetime, timezone
from enum import StrEnum
from typing import TypedDict


class Session(StrEnum):
    CLOSED = "CLOSED"
    PRE_MARKET = "PRE_MARKET"
    SESSION_1 = "SESSION_1"
    LUNCH = "LUNCH"
    SESSION_2 = "SESSION_2"
    AFTER_HOURS = "AFTER_HOURS"


class SignalType(StrEnum):
    PRICE_MOVE = "PRICE_MOVE"
    VOLUME_SPIKE = "VOLUME_SPIKE"
    COMBINED = "COMBINED"


class SignalTier(StrEnum):
    MINOR = "MINOR"
    MAJOR = "MAJOR"


class Depth(StrEnum):
    LIGHT = "LIGHT"
    FULL = "FULL"
    DEEP = "DEEP"


class TickerSignal(TypedDict):
    ticker: str
    signal_type: SignalType
    tier: SignalTier
    value: float
    detected_at: datetime


class TickerResult(TypedDict):
    snapshot_id: int
    recommendation: str
    clean_html: str
    signals: list[TickerSignal]
    sent: bool


class OrchestratorState(TypedDict):
    current_session: Session
    last_check: datetime
    signals: list[TickerSignal]
    pending_batch: list[str]
    last_run: dict[str, datetime]
    _route: str


class AnalysisState(TypedDict):
    tickers: list[str]
    depth: Depth
    session: Session
    results: dict[str, TickerResult]
    errors: dict[str, str]


def initial_orchestrator_state() -> OrchestratorState:
    return OrchestratorState(
        current_session=Session.CLOSED,
        last_check=datetime.now(timezone.utc),
        signals=[],
        pending_batch=[],
        last_run={},
        _route="skip",
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_state.py -v`
Expected: all 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add app/graph/__init__.py app/graph/state.py tests/test_state.py
git commit -m "feat(graph): add state schemas for orchestrator and analysis pipeline"
```

---

## Task 3: Session Detection

**Files:**
- Create: `app/graph/session.py`
- Test: `tests/test_session.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_session.py`:

```python
from datetime import datetime
from app.graph.state import Session
from app.graph.session import detect_session
from app.utils import WIB


def _wib(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 4, 23, hour, minute, tzinfo=WIB)


def test_closed_early_morning():
    assert detect_session(_wib(6, 0)) == Session.CLOSED


def test_pre_market():
    assert detect_session(_wib(8, 50)) == Session.PRE_MARKET


def test_session_1_open():
    assert detect_session(_wib(9, 0)) == Session.SESSION_1


def test_session_1_mid():
    assert detect_session(_wib(10, 30)) == Session.SESSION_1


def test_session_1_end():
    assert detect_session(_wib(11, 29)) == Session.SESSION_1


def test_lunch_start():
    assert detect_session(_wib(11, 30)) == Session.LUNCH


def test_lunch_mid():
    assert detect_session(_wib(12, 30)) == Session.LUNCH


def test_lunch_end():
    assert detect_session(_wib(13, 29)) == Session.LUNCH


def test_session_2_open():
    assert detect_session(_wib(13, 30)) == Session.SESSION_2


def test_session_2_mid():
    assert detect_session(_wib(14, 15)) == Session.SESSION_2


def test_session_2_end():
    assert detect_session(_wib(14, 59)) == Session.SESSION_2


def test_after_hours():
    assert detect_session(_wib(15, 0)) == Session.AFTER_HOURS


def test_after_hours_end():
    assert detect_session(_wib(15, 29)) == Session.AFTER_HOURS


def test_closed_evening():
    assert detect_session(_wib(15, 30)) == Session.CLOSED


def test_closed_night():
    assert detect_session(_wib(22, 0)) == Session.CLOSED


def test_weekend_always_closed():
    # Saturday
    sat = datetime(2026, 4, 25, 10, 0, tzinfo=WIB)
    assert detect_session(sat) == Session.CLOSED


def test_pre_market_boundary():
    assert detect_session(_wib(8, 45)) == Session.PRE_MARKET
    assert detect_session(_wib(8, 44)) == Session.CLOSED
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_session.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.graph.session'`

- [ ] **Step 3: Implement session detection**

Create `app/graph/session.py`:

```python
"""Market session detection based on WIB time."""

from datetime import datetime

from app.graph.state import Session
from app.utils import WIB


def detect_session(now: datetime | None = None) -> Session:
    """Detect current IDX market session from WIB time.

    Returns CLOSED on weekends (Saturday=5, Sunday=6).
    """
    if now is None:
        now = datetime.now(WIB)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=WIB)
    else:
        now = now.astimezone(WIB)

    if now.weekday() >= 5:
        return Session.CLOSED

    t = now.hour * 60 + now.minute  # minutes since midnight

    if t < 525:            # before 08:45
        return Session.CLOSED
    if t < 540:            # 08:45–08:59
        return Session.PRE_MARKET
    if t < 690:            # 09:00–11:29
        return Session.SESSION_1
    if t < 810:            # 11:30–13:29
        return Session.LUNCH
    if t < 900:            # 13:30–14:59
        return Session.SESSION_2
    if t < 930:            # 15:00–15:29
        return Session.AFTER_HOURS
    return Session.CLOSED  # 15:30+
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_session.py -v`
Expected: all 18 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/graph/session.py tests/test_session.py
git commit -m "feat(graph): add market session detection"
```

---

## Task 4: Signal Detection

**Files:**
- Create: `app/graph/signals.py`
- Test: `tests/test_signals.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_signals.py`:

```python
from datetime import datetime, timezone

from app.graph.signals import classify_signal, detect_signals_for_ticker
from app.graph.state import SignalType, SignalTier


def test_no_signal_small_move():
    result = classify_signal(day_change_pct=1.5, volume_ratio=0.8)
    assert result is None


def test_minor_price_signal():
    result = classify_signal(day_change_pct=3.5, volume_ratio=0.8)
    assert result is not None
    assert result["signal_type"] == SignalType.PRICE_MOVE
    assert result["tier"] == SignalTier.MINOR


def test_major_price_signal():
    result = classify_signal(day_change_pct=6.0, volume_ratio=0.8)
    assert result is not None
    assert result["signal_type"] == SignalType.PRICE_MOVE
    assert result["tier"] == SignalTier.MAJOR


def test_negative_major_price_signal():
    result = classify_signal(day_change_pct=-5.5, volume_ratio=0.8)
    assert result is not None
    assert result["signal_type"] == SignalType.PRICE_MOVE
    assert result["tier"] == SignalTier.MAJOR


def test_minor_volume_signal():
    result = classify_signal(day_change_pct=1.0, volume_ratio=1.8)
    assert result is not None
    assert result["signal_type"] == SignalType.VOLUME_SPIKE
    assert result["tier"] == SignalTier.MINOR


def test_major_volume_signal():
    result = classify_signal(day_change_pct=1.0, volume_ratio=3.5)
    assert result is not None
    assert result["signal_type"] == SignalType.VOLUME_SPIKE
    assert result["tier"] == SignalTier.MAJOR


def test_combined_signal_escalates():
    result = classify_signal(day_change_pct=3.5, volume_ratio=1.8)
    assert result is not None
    assert result["signal_type"] == SignalType.COMBINED
    assert result["tier"] == SignalTier.MAJOR


def test_detect_signals_for_ticker_with_snapshot():
    snapshot = {
        "ticker": "BBCA",
        "current_price": 9500,
        "day_change_pct": 4.0,
        "volume": 150000,
    }
    prev_snapshot = {
        "volume": 100000,
    }
    signals = detect_signals_for_ticker(snapshot, prev_snapshot)
    assert len(signals) == 1
    assert signals[0]["ticker"] == "BBCA"
    assert signals[0]["signal_type"] == SignalType.PRICE_MOVE
    assert signals[0]["tier"] == SignalTier.MINOR


def test_detect_signals_no_data():
    snapshot = {"ticker": "BBCA", "current_price": None, "day_change_pct": None, "volume": None}
    signals = detect_signals_for_ticker(snapshot, None)
    assert signals == []


def test_custom_thresholds():
    result = classify_signal(
        day_change_pct=2.0, volume_ratio=0.8,
        price_minor=1.5, price_major=3.0,
    )
    assert result is not None
    assert result["tier"] == SignalTier.MINOR
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_signals.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.graph.signals'`

- [ ] **Step 3: Implement signal detection**

Create `app/graph/signals.py`:

```python
"""Signal detection for market moves and volume spikes."""

import os
from datetime import datetime, timezone

from app.graph.state import SignalTier, SignalType, TickerSignal

PRICE_MINOR = float(os.getenv("SIGNAL_PRICE_MINOR", "3.0"))
PRICE_MAJOR = float(os.getenv("SIGNAL_PRICE_MAJOR", "5.0"))
VOLUME_MINOR = float(os.getenv("SIGNAL_VOLUME_MINOR", "1.5"))
VOLUME_MAJOR = float(os.getenv("SIGNAL_VOLUME_MAJOR", "3.0"))


def classify_signal(
    day_change_pct: float,
    volume_ratio: float,
    price_minor: float = PRICE_MINOR,
    price_major: float = PRICE_MAJOR,
    volume_minor: float = VOLUME_MINOR,
    volume_major: float = VOLUME_MAJOR,
) -> dict | None:
    """Classify a ticker's current data into a signal, or None if below thresholds."""
    abs_change = abs(day_change_pct) if day_change_pct else 0
    vol_r = volume_ratio if volume_ratio else 0

    price_hit = abs_change >= price_minor
    volume_hit = vol_r >= volume_minor
    price_major_hit = abs_change >= price_major
    volume_major_hit = vol_r >= volume_major

    if price_hit and volume_hit:
        return {
            "signal_type": SignalType.COMBINED,
            "tier": SignalTier.MAJOR,
            "value": abs_change,
        }

    if price_major_hit:
        return {
            "signal_type": SignalType.PRICE_MOVE,
            "tier": SignalTier.MAJOR,
            "value": abs_change,
        }

    if volume_major_hit:
        return {
            "signal_type": SignalType.VOLUME_SPIKE,
            "tier": SignalTier.MAJOR,
            "value": vol_r,
        }

    if price_hit:
        return {
            "signal_type": SignalType.PRICE_MOVE,
            "tier": SignalTier.MINOR,
            "value": abs_change,
        }

    if volume_hit:
        return {
            "signal_type": SignalType.VOLUME_SPIKE,
            "tier": SignalTier.MINOR,
            "value": vol_r,
        }

    return None


def detect_signals_for_ticker(
    snapshot: dict,
    prev_snapshot: dict | None,
) -> list[TickerSignal]:
    """Detect signals for a single ticker given current and previous snapshot."""
    ticker = snapshot.get("ticker", "")
    day_change_pct = snapshot.get("day_change_pct")
    volume = snapshot.get("volume")

    if day_change_pct is None and volume is None:
        return []

    volume_ratio = 0.0
    if volume and prev_snapshot and prev_snapshot.get("volume"):
        volume_ratio = volume / prev_snapshot["volume"]

    result = classify_signal(
        day_change_pct=day_change_pct or 0,
        volume_ratio=volume_ratio,
    )
    if result is None:
        return []

    return [
        TickerSignal(
            ticker=ticker,
            signal_type=result["signal_type"],
            tier=result["tier"],
            value=result["value"],
            detected_at=datetime.now(timezone.utc),
        )
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_signals.py -v`
Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/graph/signals.py tests/test_signals.py
git commit -m "feat(graph): add signal detection with configurable thresholds"
```

---

## Task 5: Modify build_prompt for Depth Support

**Files:**
- Modify: `app/fetch_portfolio.py:239-337`
- Modify: `tests/test_fetch.py`

- [ ] **Step 1: Write failing test for depth parameter**

Add to `tests/test_fetch.py`:

```python
def test_build_prompt_light_depth():
    mock_data = {
        "ticker": "BBCA", "name": "Bank BCA", "sector": "Finance",
        "industry": "Banking", "notes": "Blue chip",
        "current_price": 9000, "day_arrow": "▲", "day_change_pct": 1.5,
        "volume": 50000, "high_52w": 10000, "low_52w": 7000,
        "avg_price": 8000, "lots": 10, "total_pnl": 1000000,
        "unrealized_pnl": 1000, "unrealized_pnl_pct": 12.5,
        "position_status": "🟢 PROFIT", "dist_from_high": -10,
        "dist_from_low": 28.6, "pnl_arrow": "📈",
        "pe": 15.0, "pb": 3.0, "beta": 1.1,
        "roe_pct": 20.0, "profit_margin_pct": 30.0,
        "div_yield_pct": 2.5, "eps": 600, "debt_to_equity": 0.5,
        "market_cap": "Rp 500.00 T", "fetched_at_display": "21 Apr 2026 09:00 WIB",
    }
    result = build_prompt(mock_data, depth="LIGHT")
    assert "BBCA" in result
    assert "FUNDAMENTALS" not in result
    assert "Maximum 100 words" in result


def test_build_prompt_deep_depth():
    mock_data = {
        "ticker": "BBCA", "name": "Bank BCA", "sector": "Finance",
        "industry": "Banking", "notes": "Blue chip",
        "current_price": 9000, "day_arrow": "▲", "day_change_pct": 1.5,
        "volume": 50000, "high_52w": 10000, "low_52w": 7000,
        "avg_price": 8000, "lots": 10, "total_pnl": 1000000,
        "unrealized_pnl": 1000, "unrealized_pnl_pct": 12.5,
        "position_status": "🟢 PROFIT", "dist_from_high": -10,
        "dist_from_low": 28.6, "pnl_arrow": "📈",
        "pe": 15.0, "pb": 3.0, "beta": 1.1,
        "roe_pct": 20.0, "profit_margin_pct": 30.0,
        "div_yield_pct": 2.5, "eps": 600, "debt_to_equity": 0.5,
        "market_cap": "Rp 500.00 T", "fetched_at_display": "21 Apr 2026 09:00 WIB",
    }
    result = build_prompt(mock_data, depth="DEEP")
    assert "BBCA" in result
    assert "FUNDAMENTALS" in result
    assert "Maximum 300 words" in result
    assert "sector comparison" in result.lower() or "Sector Comparison" in result


def test_build_prompt_default_depth_unchanged():
    """Default depth=FULL preserves existing behavior."""
    mock_data = {
        "ticker": "BBCA", "name": "Bank BCA", "sector": "Finance",
        "industry": "Banking", "notes": "Blue chip",
        "current_price": 9000, "day_arrow": "▲", "day_change_pct": 1.5,
        "volume": 50000, "high_52w": 10000, "low_52w": 7000,
        "avg_price": 8000, "lots": 10, "total_pnl": 1000000,
        "unrealized_pnl": 1000, "unrealized_pnl_pct": 12.5,
        "position_status": "🟢 PROFIT", "dist_from_high": -10,
        "dist_from_low": 28.6, "pnl_arrow": "📈",
        "pe": 15.0, "pb": 3.0, "beta": 1.1,
        "roe_pct": 20.0, "profit_margin_pct": 30.0,
        "div_yield_pct": 2.5, "eps": 600, "debt_to_equity": 0.5,
        "market_cap": "Rp 500.00 T", "fetched_at_display": "21 Apr 2026 09:00 WIB",
    }
    result = build_prompt(mock_data, depth="FULL")
    assert "FUNDAMENTALS" in result
    assert "Maximum 200 words" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_fetch.py::test_build_prompt_light_depth -v`
Expected: FAIL with `TypeError: build_prompt() got an unexpected keyword argument 'depth'`

- [ ] **Step 3: Modify build_prompt to accept depth parameter**

In `app/fetch_portfolio.py`, change the `build_prompt` signature at line 239 from:

```python
def build_prompt(d: dict, history: list[dict] | None = None) -> str:
```

to:

```python
def build_prompt(d: dict, history: list[dict] | None = None, depth: str = "FULL") -> str:
```

Then, in the same function, replace the FUNDAMENTALS block and FORMAT INSTRUCTIONS section. Find the block starting at line 308:

```python
FUNDAMENTALS:
- P/E: {d['pe']}x | P/B: {d['pb']}x | Beta: {d['beta']}
- ROE: {d['roe_pct']}% | Profit Margin: {d['profit_margin_pct']}%
- Dividend Yield: {d['div_yield_pct']}% | EPS: {fmt_idr(d['eps'], 2)}
- Debt/Equity: {d['debt_to_equity']} | Market Cap: {d['market_cap']}

{trend_block}

FORMAT INSTRUCTIONS:
Write ONLY in Telegram HTML. Use ONLY tags: <b>, <i>, <code>.
Do NOT use Markdown (**, ##, -, *). Do NOT write ```html or ```.
Maximum 200 words.
```

Replace that section with depth-aware logic. The full return statement should become:

```python
    fundamentals_block = ""
    if depth != "LIGHT":
        fundamentals_block = f"""
FUNDAMENTALS:
- P/E: {d['pe']}x | P/B: {d['pb']}x | Beta: {d['beta']}
- ROE: {d['roe_pct']}% | Profit Margin: {d['profit_margin_pct']}%
- Dividend Yield: {d['div_yield_pct']}% | EPS: {fmt_idr(d['eps'], 2)}
- Debt/Equity: {d['debt_to_equity']} | Market Cap: {d['market_cap']}"""

    if depth == "LIGHT":
        word_limit = 100
        extra_instructions = ""
    elif depth == "DEEP":
        word_limit = 300
        extra_instructions = "\nInclude a Sector Comparison section: how does this stock compare to sector peers?"
    else:
        word_limit = 200
        extra_instructions = ""

    return f"""You are an IDX stock analyst helping a retail investor decide BUY/SELL/HOLD in real-time.

=== MARKET SESSION: {session} ===

=== {d['ticker']} — {d['name']} ===
Sector: {d['sector']} | {d['industry']}
Context: {d['notes']}

PRICE:
- Current  : {fmt_idr(d['current_price'])} ({d['day_arrow']} {sign(d['day_change_pct'])}{d['day_change_pct']}%)
- Volume   : {f"{d['volume']:,}" if d.get('volume') else "N/A"} lots
- 52W High : {fmt_idr(d['high_52w'])} | 52W Low: {fmt_idr(d['low_52w'])}
{pnl_block}
{fundamentals_block}

{trend_block}

FORMAT INSTRUCTIONS:
Write ONLY in Telegram HTML. Use ONLY tags: <b>, <i>, <code>.
Do NOT use Markdown (**, ##, -, *). Do NOT write ```html or ```.
Maximum {word_limit} words.{extra_instructions}

REQUIRED FORMAT (fill in the bracketed sections):

<b>{d['ticker']} {d['pnl_arrow']} {d['position_status']}</b>
<i>{d['name']} | {color_pnl(d['day_change_pct'])} {sign(d['day_change_pct'])}{d['day_change_pct']}% | {session}</i>

<b>📍 Your Position</b>
{d.get('lots',0)} lots | Bought: <code>Rp {d['avg_price']:,.2f}</code> → Now: <code>{fmt_idr(d['current_price'])}</code>
P&L/share: {color_pnl(d['unrealized_pnl'])} <code>{fmt_idr(d['unrealized_pnl'])} ({sign(d['unrealized_pnl_pct'])}{d['unrealized_pnl_pct']}%)</code>
Total P&L: {color_pnl(d.get('total_pnl'))} <code>Rp {(d.get('total_pnl') or 0):+,.0f}</code>
[1 sentence position context]

<b>⚡ Recommended Action</b>
[If total P&L below Rp 1,000,000: write MONITOR — not material enough for action]
[If total P&L above Rp 1,000,000: BUY / AVERAGE DOWN / HOLD / TRIM / CUT LOSS — 2-sentence reason + price level]

<b>⚠️ Watch Out</b>
[1 specific risk today]"""
```

- [ ] **Step 4: Run all fetch tests to verify nothing broke**

Run: `pytest tests/test_fetch.py -v`
Expected: all tests PASS (including existing ones + 3 new depth tests)

- [ ] **Step 5: Commit**

```bash
git add app/fetch_portfolio.py tests/test_fetch.py
git commit -m "feat(fetch): add depth parameter to build_prompt for variable analysis depth"
```

---

## Task 6: Analysis Pipeline (Inner Graph)

**Files:**
- Create: `app/graph/analysis.py`
- Test: `tests/test_analysis.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_analysis.py`:

```python
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

from app.graph.state import Depth, Session, AnalysisState, SignalTier
from app.graph.analysis import (
    decide_depth,
    fetch_and_snapshot,
    build_and_call_llm,
    process_output,
    build_analysis_graph,
)


def test_decide_depth_session1_major():
    assert decide_depth(Session.SESSION_1, SignalTier.MAJOR) == Depth.FULL


def test_decide_depth_session1_minor():
    assert decide_depth(Session.SESSION_1, SignalTier.MINOR) == Depth.LIGHT


def test_decide_depth_session1_none():
    assert decide_depth(Session.SESSION_1, None) == Depth.LIGHT


def test_decide_depth_after_hours():
    assert decide_depth(Session.AFTER_HOURS, None) == Depth.DEEP


def test_decide_depth_after_hours_major():
    assert decide_depth(Session.AFTER_HOURS, SignalTier.MAJOR) == Depth.DEEP


def test_decide_depth_lunch_major():
    assert decide_depth(Session.LUNCH, SignalTier.MAJOR) == Depth.FULL


def test_decide_depth_lunch_minor():
    assert decide_depth(Session.LUNCH, SignalTier.MINOR) == Depth.LIGHT


@patch("app.graph.analysis.fetch_stock")
@patch("app.graph.analysis.save_snapshot")
def test_fetch_and_snapshot_success(mock_save, mock_fetch):
    mock_fetch.return_value = {"ticker": "BBCA", "current_price": 9000}
    mock_save.return_value = 42

    data, snapshot_id, error = fetch_and_snapshot("BBCA", avg_price=8000, lots=10)
    assert data["ticker"] == "BBCA"
    assert snapshot_id == 42
    assert error is None


@patch("app.graph.analysis.fetch_stock")
def test_fetch_and_snapshot_error(mock_fetch):
    mock_fetch.return_value = {"ticker": "BBCA", "error": "Connection timeout"}

    data, snapshot_id, error = fetch_and_snapshot("BBCA")
    assert snapshot_id is None
    assert error == "Connection timeout"


@patch("app.graph.analysis.call_ollama")
@patch("app.graph.analysis.build_prompt")
@patch("app.graph.analysis.get_snapshots")
def test_build_and_call_llm(mock_snaps, mock_build, mock_ollama):
    mock_snaps.return_value = []
    mock_build.return_value = "test prompt"
    mock_ollama.return_value = "<b>HOLD</b> reason here"

    raw = build_and_call_llm(
        data={"ticker": "BBCA", "current_price": 9000},
        depth=Depth.FULL,
    )
    assert "HOLD" in raw
    mock_build.assert_called_once()
    call_kwargs = mock_build.call_args
    assert call_kwargs[1]["depth"] == "FULL"


@patch("app.graph.analysis.save_analysis")
def test_process_output(mock_save):
    mock_save.return_value = 1
    raw = "<b>Rekomendasi: HOLD</b> karena sideways."
    result = process_output(
        ticker="BBCA",
        snapshot_id=42,
        raw_llm=raw,
        model="qwen2.5:7b",
        send_telegram=False,
    )
    assert result["recommendation"] == "HOLD"
    assert "<b>" in result["clean_html"]


def test_build_analysis_graph_compiles():
    graph = build_analysis_graph()
    assert graph is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_analysis.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.graph.analysis'`

- [ ] **Step 3: Implement analysis pipeline**

Create `app/graph/analysis.py`:

```python
"""Inner LangGraph: analysis pipeline with fan-out per ticker."""

import logging
import os
from typing import Annotated

from langgraph.graph import StateGraph, END

from app.db import save_snapshot, save_analysis, get_snapshots, get_latest_analysis
from app.fetch_portfolio import (
    fetch_stock,
    build_prompt,
    call_ollama,
    clean_for_telegram,
    extract_recommendation,
    send_telegram,
    load_portfolio,
)
from app.graph.state import (
    AnalysisState,
    Depth,
    Session,
    SignalTier,
    TickerResult,
)

log = logging.getLogger(__name__)

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
GRAPH_SEND_TELEGRAM = os.getenv("GRAPH_SEND_TELEGRAM", "false").lower() == "true"


def decide_depth(session: Session, signal_tier: SignalTier | None) -> Depth:
    """Pick analysis depth based on session and signal tier."""
    if session == Session.AFTER_HOURS:
        return Depth.DEEP
    if signal_tier == SignalTier.MAJOR:
        return Depth.FULL
    return Depth.LIGHT


def fetch_and_snapshot(
    ticker: str,
    avg_price: float | None = None,
    lots: int = 0,
    notes: str = "",
) -> tuple[dict, int | None, str | None]:
    """Fetch stock data and save snapshot. Returns (data, snapshot_id, error)."""
    data = fetch_stock(ticker, avg_price=avg_price, lots=lots, notes=notes)
    if "error" in data:
        return data, None, data["error"]
    if data.get("from_cache"):
        return data, data.get("id"), None
    snapshot_id = save_snapshot(data)
    return data, snapshot_id, None


def build_and_call_llm(data: dict, depth: Depth) -> str:
    """Build prompt with depth and call Ollama. Returns raw LLM output."""
    history = get_snapshots(data["ticker"], limit=5)
    prompt = build_prompt(data, history=history, depth=depth.value)
    return call_ollama(prompt)


def process_output(
    ticker: str,
    snapshot_id: int,
    raw_llm: str,
    model: str = OLLAMA_MODEL,
    send_telegram: bool = False,
) -> TickerResult:
    """Clean, extract, save analysis. Returns TickerResult."""
    clean = clean_for_telegram(raw_llm)
    rec = extract_recommendation(clean)

    prev = get_latest_analysis(ticker)
    prev_rec = (prev.get("recommendation") or "").upper().strip() if prev else ""
    rec_changed = (rec != prev_rec) or not bool(prev_rec) or (rec == "UNKNOWN")
    is_same = not rec_changed

    save_analysis(
        snapshot_id, ticker, model,
        raw_llm, clean,
        recommendation=rec,
        sent=send_telegram and not is_same,
        skipped_same=is_same,
    )

    return TickerResult(
        snapshot_id=snapshot_id,
        recommendation=rec,
        clean_html=clean,
        signals=[],
        sent=send_telegram and not is_same,
    )


def _node_analyze_ticker(state: AnalysisState) -> AnalysisState:
    """Graph node: analyze all tickers sequentially."""
    portfolio = load_portfolio()
    results = dict(state.get("results", {}))
    errors = dict(state.get("errors", {}))

    for ticker in state["tickers"]:
        meta = portfolio.get(ticker, {})
        avg = meta.get("avg_price")
        lots = meta.get("lots", 0)
        notes = meta.get("notes", "")

        data, snapshot_id, error = fetch_and_snapshot(
            ticker, avg_price=avg, lots=lots, notes=notes,
        )
        if error:
            errors[ticker] = error
            log.warning(f"Skipping {ticker}: {error}")
            continue

        if snapshot_id is None:
            errors[ticker] = "No snapshot ID"
            continue

        depth = state.get("depth", Depth.FULL)
        raw_llm = build_and_call_llm(data, depth)
        result = process_output(
            ticker=ticker,
            snapshot_id=snapshot_id,
            raw_llm=raw_llm,
            send_telegram=GRAPH_SEND_TELEGRAM,
        )
        results[ticker] = result

    return {**state, "results": results, "errors": errors}


def _node_send_alerts(state: AnalysisState) -> AnalysisState:
    """Graph node: send Telegram alerts for results that should be sent."""
    if not GRAPH_SEND_TELEGRAM:
        return state

    for ticker, result in state.get("results", {}).items():
        if result.get("sent"):
            send_telegram(result["clean_html"])

    return state


def build_analysis_graph() -> StateGraph:
    """Build the inner analysis pipeline graph."""
    graph = StateGraph(AnalysisState)
    graph.add_node("analyze", _node_analyze_ticker)
    graph.add_node("send_alerts", _node_send_alerts)
    graph.add_edge("__start__", "analyze")
    graph.add_edge("analyze", "send_alerts")
    graph.add_edge("send_alerts", "__end__")
    return graph.compile()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_analysis.py -v`
Expected: all 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/graph/analysis.py tests/test_analysis.py
git commit -m "feat(graph): add analysis pipeline with depth-aware LLM calls"
```

---

## Task 7: Orchestrator (Outer Graph)

**Files:**
- Create: `app/graph/orchestrator.py`
- Test: `tests/test_orchestrator.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_orchestrator.py`:

```python
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

from app.graph.state import (
    Session, SignalTier, SignalType, TickerSignal,
    OrchestratorState, initial_orchestrator_state,
)
from app.graph.orchestrator import (
    route_decision,
    get_sleep_interval,
    should_run_scheduled,
    is_on_cooldown,
    build_orchestrator_graph,
)
from app.utils import WIB


def test_route_skip_when_closed_no_signals():
    result = route_decision(
        session=Session.CLOSED,
        signals=[],
        pending_batch=[],
        scheduled=False,
    )
    assert result == "skip"


def test_route_immediate_on_major_signal():
    sig = TickerSignal(
        ticker="BBCA", signal_type=SignalType.PRICE_MOVE,
        tier=SignalTier.MAJOR, value=6.0,
        detected_at=datetime.now(timezone.utc),
    )
    result = route_decision(
        session=Session.SESSION_1,
        signals=[sig],
        pending_batch=[],
        scheduled=False,
    )
    assert result == "immediate"


def test_route_batch_on_minor_signal():
    sig = TickerSignal(
        ticker="BBCA", signal_type=SignalType.PRICE_MOVE,
        tier=SignalTier.MINOR, value=3.5,
        detected_at=datetime.now(timezone.utc),
    )
    result = route_decision(
        session=Session.SESSION_1,
        signals=[sig],
        pending_batch=[],
        scheduled=False,
    )
    assert result == "batch"


def test_route_batch_on_scheduled():
    result = route_decision(
        session=Session.SESSION_1,
        signals=[],
        pending_batch=["BBCA", "BBRI"],
        scheduled=True,
    )
    assert result == "batch"


def test_route_skip_lunch_no_major():
    sig = TickerSignal(
        ticker="BBCA", signal_type=SignalType.PRICE_MOVE,
        tier=SignalTier.MINOR, value=3.5,
        detected_at=datetime.now(timezone.utc),
    )
    result = route_decision(
        session=Session.LUNCH,
        signals=[sig],
        pending_batch=[],
        scheduled=False,
    )
    assert result == "batch"


def test_route_lunch_major_immediate():
    sig = TickerSignal(
        ticker="BBCA", signal_type=SignalType.PRICE_MOVE,
        tier=SignalTier.MAJOR, value=6.0,
        detected_at=datetime.now(timezone.utc),
    )
    result = route_decision(
        session=Session.LUNCH,
        signals=[sig],
        pending_batch=[],
        scheduled=False,
    )
    assert result == "immediate"


def test_sleep_interval_active():
    assert get_sleep_interval(Session.SESSION_1) == 300


def test_sleep_interval_lunch():
    assert get_sleep_interval(Session.LUNCH) == 900


def test_sleep_interval_closed():
    assert get_sleep_interval(Session.CLOSED) == 1800


def test_sleep_interval_after_hours():
    assert get_sleep_interval(Session.AFTER_HOURS) == 1800


def test_should_run_scheduled_true():
    last = datetime.now(timezone.utc) - timedelta(minutes=35)
    assert should_run_scheduled(last, interval_min=30) is True


def test_should_run_scheduled_false():
    last = datetime.now(timezone.utc) - timedelta(minutes=10)
    assert should_run_scheduled(last, interval_min=30) is False


def test_cooldown_active():
    last_run = {
        "BBCA": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    assert is_on_cooldown("BBCA", last_run, cooldown_min=15) is True


def test_cooldown_expired():
    last_run = {
        "BBCA": datetime.now(timezone.utc) - timedelta(minutes=20),
    }
    assert is_on_cooldown("BBCA", last_run, cooldown_min=15) is False


def test_cooldown_never_run():
    assert is_on_cooldown("BBCA", {}, cooldown_min=15) is False


def test_build_orchestrator_graph_compiles():
    graph = build_orchestrator_graph()
    assert graph is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_orchestrator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.graph.orchestrator'`

- [ ] **Step 3: Implement orchestrator**

Create `app/graph/orchestrator.py`:

```python
"""Outer LangGraph: session-aware orchestrator with signal monitoring."""

import logging
import os
from datetime import datetime, timedelta, timezone

from langgraph.graph import StateGraph

from app.db import init_db, get_latest_snapshot
from app.fetch_portfolio import fetch_stock, load_portfolio
from app.graph.analysis import build_analysis_graph, decide_depth
from app.graph.session import detect_session
from app.graph.signals import detect_signals_for_ticker
from app.graph.state import (
    AnalysisState,
    OrchestratorState,
    Session,
    SignalTier,
    TickerSignal,
)

log = logging.getLogger(__name__)

COOLDOWN_MIN = int(os.getenv("SIGNAL_COOLDOWN_MIN", "15"))
SCHEDULED_INTERVAL_MIN = 30


def route_decision(
    session: Session,
    signals: list[TickerSignal],
    pending_batch: list[str],
    scheduled: bool,
) -> str:
    """Decide what to do: skip, batch, or immediate."""
    if session == Session.CLOSED:
        return "skip"

    has_major = any(s["tier"] == SignalTier.MAJOR for s in signals)

    if has_major:
        return "immediate"

    has_minor = any(s["tier"] == SignalTier.MINOR for s in signals)
    if has_minor or scheduled or pending_batch:
        return "batch"

    return "skip"


def get_sleep_interval(session: Session) -> int:
    """Return sleep interval in seconds based on session."""
    active_interval = int(os.getenv("GRAPH_ACTIVE_INTERVAL", "300"))
    idle_interval = int(os.getenv("GRAPH_IDLE_INTERVAL", "1800"))

    if session in (Session.SESSION_1, Session.SESSION_2):
        return active_interval
    if session in (Session.LUNCH, Session.PRE_MARKET):
        return 900
    return idle_interval


def should_run_scheduled(last_scheduled: datetime, interval_min: int = SCHEDULED_INTERVAL_MIN) -> bool:
    """Check if enough time has passed for a scheduled batch run."""
    elapsed = (datetime.now(timezone.utc) - last_scheduled).total_seconds() / 60
    return elapsed >= interval_min


def is_on_cooldown(ticker: str, last_run: dict[str, datetime], cooldown_min: int = COOLDOWN_MIN) -> bool:
    """Check if a ticker is on cooldown."""
    last = last_run.get(ticker)
    if last is None:
        return False
    elapsed = (datetime.now(timezone.utc) - last).total_seconds() / 60
    return elapsed < cooldown_min


def _node_detect_session(state: OrchestratorState) -> dict:
    """Detect current market session."""
    session = detect_session()
    return {"current_session": session, "last_check": datetime.now(timezone.utc)}


def _node_check_signals(state: OrchestratorState) -> dict:
    """Check all active tickers for signals."""
    session = state["current_session"]
    if session == Session.CLOSED:
        return {"signals": []}

    portfolio = load_portfolio()
    all_signals: list[TickerSignal] = []

    for ticker in portfolio:
        if is_on_cooldown(ticker, state.get("last_run", {})):
            continue
        snapshot = get_latest_snapshot(ticker)
        if not snapshot:
            continue

        prev_snapshots = []
        try:
            from app.db import get_snapshots
            prev_snapshots = get_snapshots(ticker, limit=2)
        except Exception:
            pass
        prev = prev_snapshots[1] if len(prev_snapshots) > 1 else None

        ticker_signals = detect_signals_for_ticker(snapshot, prev)
        all_signals.extend(ticker_signals)

    return {"signals": all_signals}


def _node_route(state: OrchestratorState) -> dict:
    """Route decision — sets _route key for conditional edges."""
    session = state["current_session"]
    signals = state.get("signals", [])
    pending = state.get("pending_batch", [])
    scheduled = should_run_scheduled(
        state.get("last_check", datetime.min.replace(tzinfo=timezone.utc)),
    )

    decision = route_decision(session, signals, pending, scheduled)

    if decision == "batch":
        minor_tickers = [s["ticker"] for s in signals if s["tier"] == SignalTier.MINOR]
        batch_tickers = list(set(pending + minor_tickers))
        if scheduled and not batch_tickers:
            portfolio = load_portfolio()
            batch_tickers = list(portfolio.keys())
        return {"_route": decision, "pending_batch": batch_tickers}

    if decision == "immediate":
        major_tickers = [s["ticker"] for s in signals if s["tier"] == SignalTier.MAJOR]
        return {"_route": decision, "pending_batch": major_tickers}

    return {"_route": decision}


def _node_run_analysis(state: OrchestratorState) -> dict:
    """Run analysis pipeline on pending tickers."""
    tickers = state.get("pending_batch", [])
    if not tickers:
        return {"pending_batch": []}

    session = state["current_session"]
    signal_map = {}
    for s in state.get("signals", []):
        if s["ticker"] not in signal_map or s["tier"] == SignalTier.MAJOR:
            signal_map[s["ticker"]] = s["tier"]

    overall_tier = SignalTier.MAJOR if any(
        s["tier"] == SignalTier.MAJOR for s in state.get("signals", [])
    ) else SignalTier.MINOR if state.get("signals") else None

    depth = decide_depth(session, overall_tier)

    analysis_state = AnalysisState(
        tickers=tickers,
        depth=depth,
        session=session,
        results={},
        errors={},
    )

    analysis_graph = build_analysis_graph()
    analysis_graph.invoke(analysis_state)

    now = datetime.now(timezone.utc)
    last_run = dict(state.get("last_run", {}))
    for t in tickers:
        last_run[t] = now

    return {"pending_batch": [], "signals": [], "last_run": last_run}


def _node_skip(state: OrchestratorState) -> dict:
    """No-op node for skip route."""
    return {}


def _route_edge(state: OrchestratorState) -> str:
    """Conditional edge function for routing."""
    return state.get("_route", "skip")


def build_orchestrator_graph() -> StateGraph:
    """Build the outer orchestrator graph."""
    graph = StateGraph(OrchestratorState)

    graph.add_node("detect_session", _node_detect_session)
    graph.add_node("check_signals", _node_check_signals)
    graph.add_node("route", _node_route)
    graph.add_node("run_analysis", _node_run_analysis)
    graph.add_node("skip", _node_skip)

    graph.add_edge("__start__", "detect_session")
    graph.add_edge("detect_session", "check_signals")
    graph.add_edge("check_signals", "route")
    graph.add_conditional_edges(
        "route",
        _route_edge,
        {
            "immediate": "run_analysis",
            "batch": "run_analysis",
            "skip": "skip",
        },
    )
    graph.add_edge("run_analysis", "__end__")
    graph.add_edge("skip", "__end__")

    return graph.compile()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_orchestrator.py -v`
Expected: all 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/graph/orchestrator.py tests/test_orchestrator.py
git commit -m "feat(graph): add session-aware orchestrator with signal routing"
```

---

## Task 8: Runner (Long-Running Entry Point)

**Files:**
- Create: `app/graph/runner.py`

- [ ] **Step 1: Implement runner with SIGTERM handling**

Create `app/graph/runner.py`:

```python
"""Long-running entry point for LangGraph orchestrator."""

import logging
import signal
import sys
import time

from app.db import init_db
from app.graph.orchestrator import build_orchestrator_graph, get_sleep_interval
from app.graph.state import initial_orchestrator_state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger(__name__)

_shutdown = False


def _handle_sigterm(signum, frame):
    global _shutdown
    log.info("SIGTERM received — finishing current cycle and shutting down")
    _shutdown = True


def main():
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    log.info("IDX Graph Orchestrator starting")
    init_db()

    graph = build_orchestrator_graph()
    state = initial_orchestrator_state()

    while not _shutdown:
        log.info(f"Cycle start — session: {state['current_session']}")
        try:
            state = graph.invoke(state)
        except Exception as e:
            log.error(f"Orchestrator error: {e}", exc_info=True)

        sleep_sec = get_sleep_interval(state["current_session"])
        log.info(f"Sleeping {sleep_sec}s (session: {state['current_session']})")

        elapsed = 0
        while elapsed < sleep_sec and not _shutdown:
            time.sleep(min(10, sleep_sec - elapsed))
            elapsed += 10

    log.info("Orchestrator shut down cleanly")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify it imports and runs briefly**

Run: `python -c "from app.graph.runner import main; print('runner imports OK')"`
Expected: prints `runner imports OK`

- [ ] **Step 3: Commit**

```bash
git add app/graph/runner.py
git commit -m "feat(graph): add long-running runner with graceful shutdown"
```

---

## Task 9: Docker Integration

**Files:**
- Modify: `docker/docker-compose.yml`

- [ ] **Step 1: Add idx-graph service to docker-compose.yml**

Add after the `idx-ui` service block:

```yaml
  # ── LangGraph orchestrator ──
  idx-graph:
    image: ghcr.io/marvello/my-stocks:latest
    container_name: idx-graph
    restart: unless-stopped
    user: root
    env_file: ../.env
    environment:
      - TZ=Asia/Jakarta
      - GRAPH_SEND_TELEGRAM=false
    volumes:
      - ../data:/project/data
    extra_hosts:
      - "debian-tower:host-gateway"
    command: python -m app.graph.runner
```

- [ ] **Step 2: Verify compose config parses**

Run: `docker compose -f docker/docker-compose.yml config --quiet`
Expected: exits 0 with no errors

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.yml
git commit -m "feat(docker): add idx-graph orchestrator service"
```

---

## Task 10: Update Package Init & Exports

**Files:**
- Modify: `app/graph/__init__.py`

- [ ] **Step 1: Update init with exports**

Replace `app/graph/__init__.py`:

```python
"""LangGraph orchestrator for IDX portfolio analysis."""

from app.graph.orchestrator import build_orchestrator_graph
from app.graph.analysis import build_analysis_graph
from app.graph.session import detect_session
from app.graph.state import (
    OrchestratorState,
    AnalysisState,
    TickerSignal,
    TickerResult,
    Session,
    Depth,
    SignalTier,
    SignalType,
    initial_orchestrator_state,
)

__all__ = [
    "build_orchestrator_graph",
    "build_analysis_graph",
    "detect_session",
    "OrchestratorState",
    "AnalysisState",
    "TickerSignal",
    "TickerResult",
    "Session",
    "Depth",
    "SignalTier",
    "SignalType",
    "initial_orchestrator_state",
]
```

- [ ] **Step 2: Verify all imports work**

Run: `python -c "from app.graph import build_orchestrator_graph, build_analysis_graph, detect_session, Session; print('All exports OK')"`
Expected: prints `All exports OK`

- [ ] **Step 3: Commit**

```bash
git add app/graph/__init__.py
git commit -m "chore(graph): add package exports"
```

---

## Task 11: Full Integration Test

**Files:**
- No new files — run existing + new tests together

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -v`
Expected: all tests PASS

- [ ] **Step 2: Run a dry-run of the runner (5 second timeout)**

Run: `timeout 5 python -m app.graph.runner || true`
Expected: prints startup logs, detects session, runs one cycle, then gets killed by timeout. No exceptions.

- [ ] **Step 3: Verify existing pipeline still works**

Run: `python -m app.fetch_portfolio --no-telegram --no-llm BBCA`
Expected: fetches BBCA data successfully, prints JSON. Confirms `build_prompt` depth parameter didn't break existing usage.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "test: verify full integration of graph orchestrator"
```
