from datetime import datetime, timezone

from app.graph.signals import classify_signal, detect_signals_for_ticker
from app.graph.state import SignalType, SignalTier


def test_no_signal_small_move():
    result = classify_signal(day_change_pct=1.5, volume_ratio=0.8)
    assert result is None


def test_minor_price_signal():
    result = classify_signal(day_change_pct=3.5, volume_ratio=0.8)
    assert result is not None
    assert result["signal_type"] == SignalType.PRICE_MOVE
    assert result["tier"] == SignalTier.MINOR


def test_major_price_signal():
    result = classify_signal(day_change_pct=6.0, volume_ratio=0.8)
    assert result is not None
    assert result["signal_type"] == SignalType.PRICE_MOVE
    assert result["tier"] == SignalTier.MAJOR


def test_negative_major_price_signal():
    result = classify_signal(day_change_pct=-5.5, volume_ratio=0.8)
    assert result is not None
    assert result["signal_type"] == SignalType.PRICE_MOVE
    assert result["tier"] == SignalTier.MAJOR


def test_minor_volume_signal():
    result = classify_signal(day_change_pct=1.0, volume_ratio=1.8)
    assert result is not None
    assert result["signal_type"] == SignalType.VOLUME_SPIKE
    assert result["tier"] == SignalTier.MINOR


def test_major_volume_signal():
    result = classify_signal(day_change_pct=1.0, volume_ratio=3.5)
    assert result is not None
    assert result["signal_type"] == SignalType.VOLUME_SPIKE
    assert result["tier"] == SignalTier.MAJOR


def test_combined_signal_escalates():
    result = classify_signal(day_change_pct=3.5, volume_ratio=1.8)
    assert result is not None
    assert result["signal_type"] == SignalType.COMBINED
    assert result["tier"] == SignalTier.MAJOR


def test_detect_signals_for_ticker_with_snapshot():
    snapshot = {
        "ticker": "BBCA",
        "current_price": 9500,
        "day_change_pct": 4.0,
        "volume": 150000,
    }
    prev_snapshot = {
        "volume": 100000,
    }
    signals = detect_signals_for_ticker(snapshot, prev_snapshot)
    assert len(signals) == 1
    assert signals[0]["ticker"] == "BBCA"
    assert signals[0]["signal_type"] == SignalType.PRICE_MOVE
    assert signals[0]["tier"] == SignalTier.MINOR


def test_detect_signals_no_data():
    snapshot = {"ticker": "BBCA", "current_price": None, "day_change_pct": None, "volume": None}
    signals = detect_signals_for_ticker(snapshot, None)
    assert signals == []


def test_custom_thresholds():
    result = classify_signal(
        day_change_pct=2.0, volume_ratio=0.8,
        price_minor=1.5, price_major=3.0,
    )
    assert result is not None
    assert result["tier"] == SignalTier.MINOR
