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
@patch("app.graph.analysis.get_latest_analysis")
def test_process_output(mock_latest, mock_save):
    mock_save.return_value = 1
    mock_latest.return_value = None
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
