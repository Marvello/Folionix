"""
news.py — News fetch, cache, and sentiment summarization
---------------------------------------------------------
Fetches news from Google News RSS and Indonesian financial RSS feeds.
Caches articles in SQLite. Summarizes via Ollama for sentiment injection.
"""

import logging
import os
import time
from calendar import timegm
from datetime import datetime, timedelta, timezone

import feedparser
from sqlalchemy import select

from app.db import get_engine, news_cache, news_sentiments

log = logging.getLogger(__name__)

NEWS_CACHE_HOURS = int(os.getenv("NEWS_CACHE_HOURS", "4"))
NEWS_FETCH_ENABLED = os.getenv("NEWS_FETCH_ENABLED", "true").lower() == "true"

GOOGLE_NEWS_BASE = "https://news.google.com/rss/search?hl=id&gl=ID&ceid=ID:id&q="

INDONESIAN_RSS_FEEDS = {
    "kontan": "https://www.kontan.co.id/rss",
    "cnbc_id": "https://www.cnbcindonesia.com/market/rss",
    "bisnis": "https://www.bisnis.com/rss",
}


def _parse_published(entry) -> datetime | None:
    """Parse published_parsed tuple from a feedparser entry into a UTC datetime."""
    pp = getattr(entry, "published_parsed", None)
    if pp:
        return datetime.fromtimestamp(timegm(pp), tz=timezone.utc)
    return None


def _save_articles(articles: list[dict]) -> list[dict]:
    """
    Insert articles into news_cache, skipping duplicates by URL.
    Returns only the newly inserted articles.
    """
    if not articles:
        return []
    new_articles = []
    with get_engine().begin() as conn:
        for article in articles:
            existing = conn.execute(
                select(news_cache.c.id).where(news_cache.c.url == article["url"])
            ).fetchone()
            if existing:
                continue
            conn.execute(
                news_cache.insert().values(
                    fetched_at=datetime.now(timezone.utc),
                    ticker=article.get("ticker"),
                    source=article["source"],
                    headline=article["headline"][:500],
                    summary=article.get("summary"),
                    url=article["url"][:500],
                    published_at=article.get("published_at"),
                    language=article.get("language", "id"),
                )
            )
            new_articles.append(article)
    return new_articles


def _fetch_rss(url: str, source: str, ticker: str | None = None) -> list[dict]:
    """
    Fetch and parse up to 15 entries from an RSS feed URL.
    Returns a list of article dicts. Logs but does not raise on parse errors.
    """
    try:
        feed = feedparser.parse(url)
        if feed.bozo and not feed.entries:
            log.warning(f"RSS parse error for {source}: {feed.bozo_exception}")
            return []
        articles = []
        for entry in feed.entries[:15]:
            articles.append({
                "ticker": ticker,
                "source": source,
                "headline": getattr(entry, "title", ""),
                "summary": getattr(entry, "summary", None),
                "url": getattr(entry, "link", ""),
                "published_at": _parse_published(entry),
                "language": "id",
            })
        return articles
    except Exception as e:
        log.error(f"RSS fetch failed for {source}: {e}")
        return []


def fetch_company_news(ticker: str) -> list[dict]:
    """
    Fetch news articles for a specific IDX ticker from Google News RSS
    and Indonesian financial RSS feeds. Articles are filtered by ticker
    mention for non-Google sources. New articles are saved to SQLite cache.

    Returns only newly inserted articles (empty list if all already cached).
    """
    if not NEWS_FETCH_ENABLED:
        return []
    all_articles = []
    google_url = f"{GOOGLE_NEWS_BASE}{ticker}+saham"
    all_articles.extend(_fetch_rss(google_url, "google_news", ticker=ticker))
    time.sleep(1)
    for name, url in INDONESIAN_RSS_FEEDS.items():
        feed_articles = _fetch_rss(url, name)
        for article in feed_articles:
            if ticker.upper() in (article.get("headline") or "").upper():
                article["ticker"] = ticker
                all_articles.append(article)
        time.sleep(1)
    return _save_articles(all_articles)


def fetch_macro_news() -> list[dict]:
    """
    Fetch macro-level Indonesian market news (IHSG, BI rate, IDX) from
    Google News RSS and Indonesian financial RSS feeds. Ticker is None
    for all macro articles. New articles are saved to SQLite cache.

    Returns only newly inserted articles.
    """
    if not NEWS_FETCH_ENABLED:
        return []
    all_articles = []
    for query in ["IHSG", "suku+bunga+BI", "IDX+bursa"]:
        google_url = f"{GOOGLE_NEWS_BASE}{query}"
        all_articles.extend(_fetch_rss(google_url, "google_news", ticker=None))
        time.sleep(1)
    for name, url in INDONESIAN_RSS_FEEDS.items():
        feed_articles = _fetch_rss(url, name, ticker=None)
        all_articles.extend(feed_articles)
        time.sleep(1)
    return _save_articles(all_articles)


def get_cached_news(ticker: str | None, max_age_hours: int = NEWS_CACHE_HOURS) -> list[dict]:
    """
    Retrieve cached news articles from SQLite within the given time window.

    Args:
        ticker: IDX ticker (e.g. "BBCA") or None for macro news.
        max_age_hours: Only return articles fetched within this many hours.

    Returns:
        List of article dicts ordered by published_at descending.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    with get_engine().connect() as conn:
        query = (
            select(news_cache)
            .where(news_cache.c.fetched_at >= cutoff)
            .order_by(news_cache.c.published_at.desc().nulls_last())
            .limit(20)
        )
        if ticker is None:
            query = query.where(news_cache.c.ticker.is_(None))
        else:
            query = query.where(news_cache.c.ticker == ticker.upper())
        rows = conn.execute(query).fetchall()
        return [dict(r._mapping) for r in rows]


def prune_old_news(days: int = 7) -> int:
    """
    Delete news_cache rows older than the given number of days.

    Returns the number of rows deleted.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    with get_engine().begin() as conn:
        result = conn.execute(
            news_cache.delete().where(news_cache.c.fetched_at < cutoff)
        )
        return result.rowcount
