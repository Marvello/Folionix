"""Tests for news module — cache tables, fetch, summarize."""

import os
os.environ["DATABASE_URL"] = "sqlite://"

from datetime import datetime, timezone
from app.db import init_db, get_engine, metadata, news_cache, news_sentiments


def test_news_cache_table_exists():
    init_db()
    engine = get_engine()
    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    assert "news_cache" in tables


def test_news_sentiments_table_exists():
    init_db()
    engine = get_engine()
    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    assert "news_sentiments" in tables


# ── NEWS FETCH + CACHE TESTS ──

import json
from unittest.mock import patch, MagicMock
from sqlalchemy import select
from app.news import fetch_company_news, fetch_macro_news, get_cached_news, summarize_news


MOCK_RSS_FEED = MagicMock()
MOCK_RSS_FEED.bozo = False
MOCK_RSS_FEED.entries = [
    MagicMock(
        title="BBCA catat laba bersih naik 10%",
        summary="Bank Central Asia mencatat kenaikan laba...",
        link="https://example.com/bbca-laba",
        published_parsed=(2026, 4, 29, 8, 0, 0, 0, 0, 0),
    ),
    MagicMock(
        title="BBCA ekspansi kredit digital",
        summary="BCA memperluas layanan digital banking...",
        link="https://example.com/bbca-digital",
        published_parsed=(2026, 4, 29, 7, 0, 0, 0, 0, 0),
    ),
]


@patch("app.news.time.sleep")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_fetch_company_news_parses_rss(mock_parse, mock_sleep):
    init_db()
    articles = fetch_company_news("BBCA")
    assert len(articles) >= 1
    assert articles[0]["headline"] == "BBCA catat laba bersih naik 10%"
    assert articles[0]["source"] == "google_news"
    assert articles[0]["url"] == "https://example.com/bbca-laba"


@patch("app.news.time.sleep")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_fetch_company_news_deduplicates(mock_parse, mock_sleep):
    init_db()
    first = fetch_company_news("BBCA")
    second = fetch_company_news("BBCA")
    assert len(second) == 0  # already cached, no new articles


@patch("app.news.time.sleep")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_get_cached_news_returns_articles(mock_parse, mock_sleep):
    init_db()
    fetch_company_news("BBCA")
    cached = get_cached_news("BBCA", max_age_hours=4)
    assert len(cached) >= 1
    assert cached[0]["ticker"] == "BBCA"


@patch("app.news.time.sleep")
@patch("app.news.feedparser.parse")
def test_fetch_macro_news(mock_parse, mock_sleep):
    macro_feed = MagicMock()
    macro_feed.bozo = False
    macro_feed.entries = [
        MagicMock(
            title="IHSG ditutup menguat 1.2%",
            summary="Indeks Harga Saham Gabungan menguat...",
            link="https://example.com/ihsg-naik",
            published_parsed=(2026, 4, 29, 9, 0, 0, 0, 0, 0),
        ),
    ]
    mock_parse.return_value = macro_feed
    init_db()
    articles = fetch_macro_news()
    assert len(articles) >= 1
    assert articles[0]["ticker"] is None


# ── SENTIMENT SUMMARIZATION TESTS ──

MOCK_OLLAMA_RESPONSE = {
    "message": {
        "content": json.dumps({
            "score": 3,
            "themes": ["laba bersih naik", "ekspansi kredit digital"],
            "catalyst": "BI rate cut diharapkan bulan depan",
            "risk": "foreign fund outflow meningkat",
        })
    }
}


@patch("app.news.time.sleep")
@patch("app.news.requests.post")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_summarize_news_returns_sentiment(mock_parse, mock_post, mock_sleep):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OLLAMA_RESPONSE
    mock_resp.raise_for_status = MagicMock()
    mock_post.return_value = mock_resp

    init_db()
    fetch_company_news("BBCA")
    articles = get_cached_news("BBCA")
    result = summarize_news("BBCA", articles, depth="FULL")

    assert result is not None
    assert result["score"] == 3
    assert len(result["themes"]) == 2
    assert result["catalyst"] is not None


@patch("app.news.requests.post")
def test_summarize_news_empty_articles(mock_post):
    init_db()
    result = summarize_news("BBCA", [], depth="FULL")
    assert result is None
    mock_post.assert_not_called()


@patch("app.news.time.sleep")
@patch("app.news.requests.post")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_summarize_news_caches_result(mock_parse, mock_post, mock_sleep):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OLLAMA_RESPONSE
    mock_resp.raise_for_status = MagicMock()
    mock_post.return_value = mock_resp

    init_db()
    fetch_company_news("BBCA")
    articles = get_cached_news("BBCA")
    summarize_news("BBCA", articles, depth="FULL")

    with get_engine().connect() as conn:
        rows = conn.execute(
            select(news_sentiments).where(news_sentiments.c.ticker == "BBCA")
        ).fetchall()
    assert len(rows) >= 1
    assert rows[0]._mapping["score"] == 3
