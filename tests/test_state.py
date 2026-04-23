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
