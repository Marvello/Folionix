"""Signal detection for market moves and volume spikes."""

import os
from datetime import datetime, timezone

from app.graph.state import SignalTier, SignalType, TickerSignal

PRICE_MINOR = float(os.getenv("SIGNAL_PRICE_MINOR", "3.0"))
PRICE_MAJOR = float(os.getenv("SIGNAL_PRICE_MAJOR", "5.0"))
VOLUME_MINOR = float(os.getenv("SIGNAL_VOLUME_MINOR", "1.5"))
VOLUME_MAJOR = float(os.getenv("SIGNAL_VOLUME_MAJOR", "3.0"))


def classify_signal(
    day_change_pct: float,
    volume_ratio: float,
    price_minor: float = PRICE_MINOR,
    price_major: float = PRICE_MAJOR,
    volume_minor: float = VOLUME_MINOR,
    volume_major: float = VOLUME_MAJOR,
) -> dict | None:
    """Classify a ticker's current data into a signal, or None if below thresholds."""
    abs_change = abs(day_change_pct) if day_change_pct else 0
    vol_r = volume_ratio if volume_ratio else 0

    price_hit = abs_change >= price_minor
    volume_hit = vol_r > volume_minor
    price_major_hit = abs_change >= price_major
    volume_major_hit = vol_r >= volume_major

    if price_hit and volume_hit:
        return {
            "signal_type": SignalType.COMBINED,
            "tier": SignalTier.MAJOR,
            "value": abs_change,
        }

    if price_major_hit:
        return {
            "signal_type": SignalType.PRICE_MOVE,
            "tier": SignalTier.MAJOR,
            "value": abs_change,
        }

    if volume_major_hit:
        return {
            "signal_type": SignalType.VOLUME_SPIKE,
            "tier": SignalTier.MAJOR,
            "value": vol_r,
        }

    if price_hit:
        return {
            "signal_type": SignalType.PRICE_MOVE,
            "tier": SignalTier.MINOR,
            "value": abs_change,
        }

    if volume_hit:
        return {
            "signal_type": SignalType.VOLUME_SPIKE,
            "tier": SignalTier.MINOR,
            "value": vol_r,
        }

    return None


def detect_signals_for_ticker(
    snapshot: dict,
    prev_snapshot: dict | None,
) -> list[TickerSignal]:
    """Detect signals for a single ticker given current and previous snapshot."""
    ticker = snapshot.get("ticker", "")
    day_change_pct = snapshot.get("day_change_pct")
    volume = snapshot.get("volume")

    if day_change_pct is None and volume is None:
        return []

    volume_ratio = 0.0
    if volume and prev_snapshot and prev_snapshot.get("volume"):
        volume_ratio = volume / prev_snapshot["volume"]

    result = classify_signal(
        day_change_pct=day_change_pct or 0,
        volume_ratio=volume_ratio,
    )
    if result is None:
        return []

    return [
        TickerSignal(
            ticker=ticker,
            signal_type=result["signal_type"],
            tier=result["tier"],
            value=result["value"],
            detected_at=datetime.now(timezone.utc),
        )
    ]
