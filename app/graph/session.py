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
