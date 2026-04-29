"""Integration tests for news sentiment injection into prompts."""

import os
os.environ["DATABASE_URL"] = "sqlite://"

from app.fetch_portfolio import build_prompt
from app.analyze_watchlist import build_watchlist_prompt


SAMPLE_DATA = {
    "ticker": "BBCA",
    "name": "Bank Central Asia",
    "sector": "Financial Services",
    "industry": "Banks",
    "notes": "Blue chip banking",
    "current_price": 10000,
    "day_change_pct": 1.5,
    "day_arrow": "▲",
    "volume": 50000,
    "high_52w": 11000,
    "low_52w": 8000,
    "avg_price": 9000,
    "lots": 10,
    "unrealized_pnl": 1000,
    "unrealized_pnl_pct": 11.11,
    "total_pnl": 1000000,
    "position_status": "🟢 PROFIT",
    "pnl_arrow": "📈",
    "dist_from_high": -9.1,
    "dist_from_low": 25.0,
    "pe": 15.0,
    "pb": 3.0,
    "roe_pct": 20.0,
    "profit_margin_pct": 35.0,
    "div_yield_pct": 2.5,
    "eps": 700,
    "debt_to_equity": 0.5,
    "beta": 1.1,
    "market_cap": "Rp 1,200.00 T",
}


# ── Task 4: portfolio prompt tests ───────────────────────────────────────────

def test_build_prompt_with_news_sentiment():
    sentiment = {
        "score": 3,
        "themes": ["laba bersih naik", "ekspansi digital"],
        "catalyst": "BI rate cut diharapkan",
        "risk": "foreign outflow meningkat",
    }
    prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
    assert "NEWS SENTIMENT" in prompt
    assert "+3" in prompt
    assert "laba bersih naik" in prompt
    assert "BI rate cut" in prompt
    assert "foreign outflow" in prompt


def test_build_prompt_without_news_sentiment():
    prompt = build_prompt(SAMPLE_DATA)
    assert "NEWS SENTIMENT" not in prompt


def test_build_prompt_news_before_format_instructions():
    sentiment = {
        "score": 1,
        "themes": ["test theme"],
        "catalyst": None,
        "risk": None,
    }
    prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
    news_pos = prompt.index("NEWS SENTIMENT")
    format_pos = prompt.index("FORMAT INSTRUCTIONS")
    assert news_pos < format_pos


def test_build_prompt_bearish_news():
    sentiment = {
        "score": -2,
        "themes": ["kredit macet naik"],
        "catalyst": None,
        "risk": "NPL meningkat",
    }
    prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
    assert "Bearish" in prompt
    assert "-2" in prompt
    assert "NPL meningkat" in prompt


def test_build_prompt_neutral_news():
    sentiment = {
        "score": 0,
        "themes": [],
        "catalyst": None,
        "risk": None,
    }
    prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
    assert "Neutral" in prompt


def test_build_prompt_news_extra_instructions():
    sentiment = {"score": 2, "themes": [], "catalyst": None, "risk": None}
    prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
    assert "Factor news sentiment" in prompt


# ── Task 5: watchlist prompt tests ───────────────────────────────────────────

WATCHLIST_DATA = {
    "ticker": "TLKM",
    "name": "Telkom Indonesia",
    "current_price": 3500,
    "volume": 100000,
    "high_52w": 4200,
    "low_52w": 2800,
    "dist_from_high": -16.7,
    "dist_from_low": 25.0,
    "pe": 12.0,
    "pb": 2.0,
    "roe_pct": 18.0,
    "div_yield_pct": 4.0,
}


def test_build_watchlist_prompt_with_news():
    sentiment = {
        "score": -2,
        "themes": ["penurunan ARPU", "kompetisi ketat"],
        "catalyst": None,
        "risk": "regulasi baru telekomunikasi",
    }
    prompt = build_watchlist_prompt(WATCHLIST_DATA, news_sentiment=sentiment)
    assert "NEWS SENTIMENT" in prompt
    assert "-2" in prompt
    assert "penurunan ARPU" in prompt


def test_build_watchlist_prompt_without_news():
    prompt = build_watchlist_prompt(WATCHLIST_DATA)
    assert "NEWS SENTIMENT" not in prompt


def test_build_watchlist_prompt_news_before_format_instructions():
    sentiment = {
        "score": 1,
        "themes": ["pertumbuhan 5G"],
        "catalyst": "ekspansi fiber",
        "risk": None,
    }
    prompt = build_watchlist_prompt(WATCHLIST_DATA, news_sentiment=sentiment)
    news_pos = prompt.index("NEWS SENTIMENT")
    format_pos = prompt.index("FORMAT INSTRUCTIONS")
    assert news_pos < format_pos


def test_build_watchlist_prompt_bullish_news():
    sentiment = {
        "score": 4,
        "themes": ["laba meningkat"],
        "catalyst": "kontrak pemerintah baru",
        "risk": None,
    }
    prompt = build_watchlist_prompt(WATCHLIST_DATA, news_sentiment=sentiment)
    assert "Bullish" in prompt
    assert "+4" in prompt
    assert "kontrak pemerintah baru" in prompt


def test_build_watchlist_prompt_news_instruction():
    sentiment = {"score": 1, "themes": [], "catalyst": None, "risk": None}
    prompt = build_watchlist_prompt(WATCHLIST_DATA, news_sentiment=sentiment)
    assert "Use the news sentiment" in prompt


# ── Task 12: End-to-end pipeline integration test ────────────────────────────

from unittest.mock import patch, MagicMock
from app.db import init_db


def test_full_news_pipeline_mock():
    """End-to-end: fetch → summarize → inject into prompt."""
    init_db()

    mock_feed = MagicMock()
    mock_feed.bozo = False
    mock_feed.entries = [
        MagicMock(
            title="BBCA laba bersih naik 15%",
            summary="Kinerja solid di Q1 2026",
            link="https://example.com/bbca-q1-e2e",
            published_parsed=(2026, 4, 29, 8, 0, 0, 0, 0, 0),
        ),
    ]

    mock_ollama_resp = MagicMock()
    mock_ollama_resp.status_code = 200
    mock_ollama_resp.json.return_value = {
        "message": {
            "content": '{"score": 4, "themes": ["laba naik 15%"], "catalyst": "kinerja Q1 solid", "risk": null}'
        }
    }
    mock_ollama_resp.raise_for_status = MagicMock()

    with patch("app.news.feedparser.parse", return_value=mock_feed):
        with patch("app.news.requests.post", return_value=mock_ollama_resp):
            with patch("app.news.time.sleep"):
                from app.news import fetch_company_news, get_cached_news, summarize_news

                # Use BMRI to avoid cache collision with BBCA from test_news.py
                fetch_company_news("BMRI")
                articles = get_cached_news("BMRI")
                assert len(articles) >= 1

                sentiment = summarize_news("BMRI", articles, depth="FULL")
                assert sentiment is not None
                assert sentiment["score"] == 4

                prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
                assert "NEWS SENTIMENT" in prompt
                assert "+4" in prompt
                assert "laba naik 15%" in prompt
                assert "kinerja Q1 solid" in prompt
