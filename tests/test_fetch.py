import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fetch_portfolio import clean_for_telegram, extract_recommendation, build_prompt

def test_clean_strips_markdown_fences():
    raw = "```html\n<b>Hello</b>\n```"
    result = clean_for_telegram(raw)
    assert "<b>Hello</b>" in result
    assert "```" not in result

def test_clean_strips_unsupported_tags():
    raw = "<div><b>Hello</b><span>world</span></div>"
    result = clean_for_telegram(raw)
    assert "<b>Hello</b>" in result
    assert "<div>" not in result
    assert "<span>" not in result

def test_clean_converts_headings():
    raw = "<h2>Title</h2>"
    result = clean_for_telegram(raw)
    assert "<b>Title</b>" in result
    assert "<h2>" not in result

def test_clean_converts_lists():
    raw = "<ul><li>Item 1</li><li>Item 2</li></ul>"
    result = clean_for_telegram(raw)
    assert "• Item 1" in result
    assert "• Item 2" in result

def test_extract_recommendation_hold():
    assert extract_recommendation("Rekomendasi: HOLD saat ini.") == "HOLD"

def test_extract_recommendation_buy():
    assert extract_recommendation("Saatnya BUY di level support.") == "BUY"

def test_extract_recommendation_cut_loss():
    assert extract_recommendation("Pertimbangkan CUT LOSS jika turun lagi.") == "CUT LOSS"

def test_extract_recommendation_average_down():
    assert extract_recommendation("Bisa AVERAGE DOWN di harga ini.") == "AVERAGE DOWN"

def test_extract_recommendation_monitor():
    assert extract_recommendation("Saat ini MONITOR dulu, tunggu konfirmasi.") == "MONITOR"

def test_extract_recommendation_monitor_not_false_buy():
    """MONITOR should match before BUY even if template text contains 'Harga Beli'."""
    text = "Rekomendasi: MONITOR. Harga Beli Rata-rata: Rp 5.000"
    assert extract_recommendation(text) == "MONITOR"

def test_extract_recommendation_unknown():
    assert extract_recommendation("No clear action here.") == "UNKNOWN"

def test_build_prompt_returns_string():
    mock_data = {
        "ticker": "BBCA", "name": "Bank BCA", "sector": "Finance",
        "industry": "Banking", "notes": "Blue chip",
        "current_price": 9000, "day_arrow": "▲", "day_change_pct": 1.5,
        "volume": 50000, "high_52w": 10000, "low_52w": 7000,
        "avg_price": 8000, "lots": 10, "total_pnl": 1000000,
        "unrealized_pnl": 1000, "unrealized_pnl_pct": 12.5,
        "position_status": "🟢 PROFIT", "dist_from_high": -10,
        "dist_from_low": 28.6, "pnl_arrow": "📈",
        "pe": 15.0, "pb": 3.0, "beta": 1.1,
        "roe_pct": 20.0, "profit_margin_pct": 30.0,
        "div_yield_pct": 2.5, "eps": 600, "debt_to_equity": 0.5,
        "market_cap": "Rp 500.00 T", "fetched_at_display": "21 Apr 2026 09:00 WIB",
    }
    result = build_prompt(mock_data)
    assert isinstance(result, str)
    assert "BBCA" in result
    assert "Bank BCA" in result
