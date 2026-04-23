"""Outer LangGraph: session-aware orchestrator with signal monitoring."""

import logging
import os
from datetime import datetime, timedelta, timezone

from langgraph.graph import StateGraph

from app.db import init_db, get_latest_snapshot, get_snapshots
from app.fetch_portfolio import load_portfolio
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

        prev_snapshots = get_snapshots(ticker, limit=2)
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


def build_orchestrator_graph():
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
