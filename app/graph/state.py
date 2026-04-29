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
    last_news_fetch: datetime
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
        last_news_fetch=datetime.min.replace(tzinfo=timezone.utc),
        _route="skip",
    )
