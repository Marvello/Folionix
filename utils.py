"""Shared helpers for IDX Portfolio Analyzer."""

import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Optional

WIB = timezone(timedelta(hours=7))

GITHUB_REPO_URL = "https://github.com/Marvello/my-stocks"

_version_cache: str | None = None


def get_version() -> str:
    """Return short git commit hash, cached after first call."""
    global _version_cache
    if _version_cache is not None:
        return _version_cache
    # Try GIT_COMMIT env var first (set at Docker build time)
    v = os.getenv("GIT_COMMIT", "").strip()
    if not v:
        try:
            v = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                stderr=subprocess.DEVNULL, text=True
            ).strip()
        except Exception:
            v = "unknown"
    _version_cache = v[:7] if len(v) > 7 else v
    return _version_cache


def get_version_url() -> str:
    """Return GitHub commit URL for current version."""
    return f"{GITHUB_REPO_URL}/commit/{get_version()}"


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


def calc_pnl(current_price: float, avg_price: float, lots: int = 0) -> dict:
    """Calculate P&L metrics. Returns dict with pnl, pnl_pct, total_pnl, invested."""
    pnl = round(current_price - avg_price, 0)
    pnl_pct = round((pnl / avg_price) * 100, 2) if avg_price else 0
    total_pnl = round(pnl * lots * 100, 0) if lots else 0
    invested = avg_price * lots * 100 if (avg_price and lots) else 0
    return {
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "total_pnl": total_pnl,
        "invested": invested,
    }


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


def sanitize_html(html: str) -> str:
    """Strip all HTML tags except b, i, code."""
    return re.sub(r"<(?!\/?(?:b|i|code)(?:\s[^>]*)?>)[^>]+>", "", html)
