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

from unittest.mock import patch, MagicMock
from app.news import fetch_company_news, fetch_macro_news, get_cached_news


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
