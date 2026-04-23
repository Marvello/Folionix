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
    sat = datetime(2026, 4, 25, 10, 0, tzinfo=WIB)
    assert detect_session(sat) == Session.CLOSED


def test_pre_market_boundary():
    assert detect_session(_wib(8, 45)) == Session.PRE_MARKET
    assert detect_session(_wib(8, 44)) == Session.CLOSED
