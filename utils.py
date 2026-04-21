"""Shared helpers for IDX Portfolio Analyzer."""

from datetime import datetime, timedelta, timezone
from typing import Optional

WIB = timezone(timedelta(hours=7))


def safe_float(val, decimals: int = 2) -> Optional[float]:
    try:
        f = float(val)
        if f != f or abs(f) > 1e15:
            return None
        return round(f, decimals)
    except (TypeError, ValueError):
        return None


def fmt_idr(val, decimals: int = 0) -> str:
    if val is None:
        return "N/A"
    return f"Rp {val:,.{decimals}f}"


def fmt_cap(val) -> str:
    if val is None:
        return "N/A"
    v = float(val)
    if v >= 1e12: return f"Rp {v/1e12:.2f} T"
    if v >= 1e9:  return f"Rp {v/1e9:.2f} M"
    return fmt_idr(v)


def sign(val) -> str:
    return "+" if val and val > 0 else ""


def normalize_ticker(ticker: str) -> str:
    t = ticker.upper().strip()
    if t in ("IHSG", "JKSE", "^JKSE"):   return "^JKSE"
    if t in ("LQ45", "^JKLQ45"):          return "^JKLQ45"
    if not t.startswith("^") and not t.endswith(".JK"):
        return t + ".JK"
    return t


def pnl_icon(pct) -> str:
    if pct is None: return "❓"
    if pct >= 10:  return "🟢"
    if pct >= 2:   return "🟢"
    if pct >= -2:  return "⚪"
    if pct >= -10: return "🟡"
    return "🔴"


def now_wib() -> datetime:
    """Current time in WIB (Asia/Jakarta, UTC+7)."""
    return datetime.now(WIB)


def to_wib(dt: datetime) -> datetime:
    """Convert a datetime to WIB. Assumes UTC if naive."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(WIB)


def fmt_wib(dt: datetime) -> str:
    """Format a datetime as WIB display string."""
    return to_wib(dt).strftime("%d %b %Y %H:%M WIB")
