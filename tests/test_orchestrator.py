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
