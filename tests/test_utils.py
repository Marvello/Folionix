import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils import fmt_idr, fmt_cap, sign, safe_float, normalize_ticker, pnl_icon, calc_pnl, WIB, now_wib, fmt_wib, to_wib

from datetime import datetime, timezone, timedelta

def test_fmt_idr_basic():
    assert fmt_idr(1000) == "Rp 1,000"
    assert fmt_idr(1000, 2) == "Rp 1,000.00"
    assert fmt_idr(None) == "N/A"

def test_fmt_cap():
    assert fmt_cap(1.5e12) == "Rp 1.50 T"
    assert fmt_cap(2.3e9) == "Rp 2.30 M"
    assert fmt_cap(None) == "N/A"

def test_sign():
    assert sign(5) == "+"
    assert sign(-3) == ""
    assert sign(0) == ""
    assert sign(None) == ""

def test_safe_float():
    assert safe_float(3.14159, 2) == 3.14
    assert safe_float("bad") is None
    assert safe_float(float("nan")) is None
    assert safe_float(float("inf")) is None

def test_normalize_ticker():
    assert normalize_ticker("BBCA") == "BBCA.JK"
    assert normalize_ticker("bbca") == "BBCA.JK"
    assert normalize_ticker("BBCA.JK") == "BBCA.JK"
    assert normalize_ticker("IHSG") == "^JKSE"
    assert normalize_ticker("^JKSE") == "^JKSE"
    assert normalize_ticker("LQ45") == "^JKLQ45"

def test_pnl_icon():
    assert pnl_icon(15) == "🟢"
    assert pnl_icon(5) == "🟢"
    assert pnl_icon(0) == "⚪"
    assert pnl_icon(-5) == "🟡"
    assert pnl_icon(-15) == "🔴"
    assert pnl_icon(-25) == "🔴"
    assert pnl_icon(None) == "❓"

def test_calc_pnl():
    p = calc_pnl(10000, 8000, 10)
    assert p["pnl"] == 2000
    assert p["pnl_pct"] == 25.0
    assert p["total_pnl"] == 2000 * 10 * 100  # 2_000_000
    assert p["invested"] == 8000 * 10 * 100    # 8_000_000

def test_calc_pnl_loss():
    p = calc_pnl(7000, 8000, 5)
    assert p["pnl"] == -1000
    assert p["pnl_pct"] == -12.5
    assert p["total_pnl"] == -1000 * 5 * 100

def test_calc_pnl_zero_lots():
    p = calc_pnl(10000, 8000, 0)
    assert p["total_pnl"] == 0
    assert p["invested"] == 0

def test_now_wib_is_aware():
    dt = now_wib()
    assert dt.tzinfo is not None
    assert dt.utcoffset() == timedelta(hours=7)

def test_fmt_wib_from_utc():
    utc_dt = datetime(2026, 4, 21, 2, 0, 0, tzinfo=timezone.utc)
    result = fmt_wib(utc_dt)
    assert "09:00 WIB" in result

def test_fmt_wib_from_naive():
    naive = datetime(2026, 4, 21, 2, 0, 0)
    result = fmt_wib(naive)
    assert "09:00 WIB" in result
