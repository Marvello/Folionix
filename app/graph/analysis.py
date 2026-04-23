"""Inner LangGraph: analysis pipeline with fan-out per ticker."""

import logging
import os

from langgraph.graph import StateGraph

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


def build_analysis_graph():
    """Build the inner analysis pipeline graph."""
    graph = StateGraph(AnalysisState)
    graph.add_node("analyze", _node_analyze_ticker)
    graph.add_node("send_alerts", _node_send_alerts)
    graph.add_edge("__start__", "analyze")
    graph.add_edge("analyze", "send_alerts")
    graph.add_edge("send_alerts", "__end__")
    return graph.compile()
