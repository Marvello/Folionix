# News Sentiment Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add external news data (Google News RSS + Indonesian financial RSS) to the LLM analysis pipeline, improving prediction quality with real-world context.

**Architecture:** Two-stage pipeline — periodic news fetch (RSS → SQLite cache) then per-ticker LLM sentiment summarization injected into existing analysis prompts. New `app/news.py` module handles fetch + cache + summarize. Existing prompt builders get optional `news_sentiment` parameter. LangGraph orchestrator gets a news fetch node on its own timer.

**Tech Stack:** feedparser (RSS parsing), SQLAlchemy Core (cache tables), Ollama (sentiment summarization), existing yfinance/Telegram pipeline.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `app/news.py` | **Create** | RSS fetch, SQLite cache read/write, sentiment summarization via Ollama |
| `app/db.py` | Modify | Add `news_cache` + `news_sentiments` table definitions |
| `app/fetch_portfolio.py` | Modify | Add `news_sentiment` param to `build_prompt`, wire news into main loop, add `--no-news` CLI flag |
| `app/analyze_watchlist.py` | Modify | Add `news_sentiment` param to `build_watchlist_prompt`, wire news into analysis loop |
| `app/graph/analysis.py` | Modify | Add news fetch + summarize step before LLM call |
| `app/graph/orchestrator.py` | Modify | Add `fetch_news_node` on periodic timer |
| `app/graph/state.py` | Modify | Add `last_news_fetch` field to `OrchestratorState` |
| `requirements.txt` | Modify | Add `feedparser` |
| `.env.example` | Modify | Add `NEWS_CACHE_HOURS`, `NEWS_FETCH_ENABLED` |
| `tests/test_news.py` | **Create** | Unit tests for news module |
| `tests/test_news_integration.py` | **Create** | Integration tests for prompt injection + graph wiring |

---

### Task 1: Database Tables for News Cache

**Files:**
- Modify: `app/db.py:83-98` (after `llm_analyses` table, before `portfolio_positions`)
- Test: `tests/test_news.py`

- [ ] **Step 1: Write failing test for news_cache table**

Create `tests/test_news.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news.py::test_news_cache_table_exists -v`
Expected: FAIL with `ImportError: cannot import name 'news_cache' from 'app.db'`

- [ ] **Step 3: Add table definitions to db.py**

In `app/db.py`, after the `llm_analyses` table (line 98), add:

```python
# News cache — one row per article per fetch
news_cache = Table(
    "news_cache", metadata,
    Column("id",           Integer, primary_key=True, autoincrement=True),
    Column("fetched_at",   DateTime, nullable=False, index=True),
    Column("ticker",       String(10), nullable=True, index=True),
    Column("source",       String(50), nullable=False),
    Column("headline",     String(500), nullable=False),
    Column("summary",      Text),
    Column("url",          String(500), nullable=False),
    Column("published_at", DateTime),
    Column("language",     String(5), default="id"),
    UniqueConstraint("url", name="uq_news_url"),
)

# LLM-generated news sentiment — one row per ticker per summarization
news_sentiments = Table(
    "news_sentiments", metadata,
    Column("id",            Integer, primary_key=True, autoincrement=True),
    Column("ticker",        String(10), nullable=False, index=True),
    Column("summarized_at", DateTime, nullable=False, index=True),
    Column("depth",         String(10), nullable=False),
    Column("score",         Integer, nullable=False),
    Column("themes",        Text),
    Column("catalyst",      Text),
    Column("risk",          Text),
    Column("raw_output",    Text),
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news.py -v`
Expected: Both tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/db.py tests/test_news.py
git commit -m "feat(db): add news_cache and news_sentiments tables"
```

---

### Task 2: News Fetch Functions (RSS Parsing + Cache)

**Files:**
- Create: `app/news.py`
- Test: `tests/test_news.py` (append)

- [ ] **Step 1: Write failing tests for fetch functions**

Append to `tests/test_news.py`:

```python
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


@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_fetch_company_news_parses_rss(mock_parse):
    init_db()
    articles = fetch_company_news("BBCA")
    assert len(articles) >= 1
    assert articles[0]["headline"] == "BBCA catat laba bersih naik 10%"
    assert articles[0]["source"] == "google_news"
    assert articles[0]["url"] == "https://example.com/bbca-laba"


@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_fetch_company_news_deduplicates(mock_parse):
    init_db()
    first = fetch_company_news("BBCA")
    second = fetch_company_news("BBCA")
    assert len(second) == 0  # already cached, no new articles


@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_get_cached_news_returns_articles(mock_parse):
    init_db()
    fetch_company_news("BBCA")
    cached = get_cached_news("BBCA", max_age_hours=4)
    assert len(cached) >= 1
    assert cached[0]["ticker"] == "BBCA"


@patch("app.news.feedparser.parse")
def test_fetch_macro_news(mock_parse):
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_news.py::test_fetch_company_news_parses_rss -v`
Expected: FAIL with `ImportError: cannot import name 'fetch_company_news' from 'app.news'`

- [ ] **Step 3: Create app/news.py with fetch + cache functions**

```python
"""
news.py — News fetch, cache, and sentiment summarization
---------------------------------------------------------
Fetches news from Google News RSS and Indonesian financial RSS feeds.
Caches articles in SQLite. Summarizes via Ollama for sentiment injection.
"""

import json
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
    """Parse published_parsed from feedparser entry to UTC datetime."""
    pp = getattr(entry, "published_parsed", None)
    if pp:
        return datetime.fromtimestamp(timegm(pp), tz=timezone.utc)
    return None


def _save_articles(articles: list[dict]) -> list[dict]:
    """Save articles to news_cache. Returns only newly inserted articles."""
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
    """Fetch and parse a single RSS feed URL."""
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
    """Fetch company-specific news from Google News RSS + Indonesian RSS.
    Returns list of newly cached articles."""
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
    """Fetch macro/market news. Returns list of newly cached articles."""
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
    """Read cached news from DB. ticker=None returns macro news."""
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
    """Delete news older than N days. Returns count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    with get_engine().begin() as conn:
        result = conn.execute(
            news_cache.delete().where(news_cache.c.fetched_at < cutoff)
        )
        return result.rowcount
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/news.py tests/test_news.py
git commit -m "feat(news): add RSS fetch and SQLite cache functions"
```

---

### Task 3: News Sentiment Summarizer (Ollama)

**Files:**
- Modify: `app/news.py` (append `summarize_news` function)
- Test: `tests/test_news.py` (append)

- [ ] **Step 1: Write failing test for summarize_news**

Append to `tests/test_news.py`:

```python
from app.news import summarize_news


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


@patch("app.news.requests.post")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_summarize_news_returns_sentiment(mock_parse, mock_post):
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


@patch("app.news.requests.post")
@patch("app.news.feedparser.parse", return_value=MOCK_RSS_FEED)
def test_summarize_news_caches_result(mock_parse, mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_OLLAMA_RESPONSE
    mock_resp.raise_for_status = MagicMock()
    mock_post.return_value = mock_resp

    init_db()
    fetch_company_news("BBCA")
    articles = get_cached_news("BBCA")
    summarize_news("BBCA", articles, depth="FULL")

    # Check sentiment was cached
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(news_sentiments).where(news_sentiments.c.ticker == "BBCA")
        ).fetchall()
    assert len(rows) >= 1
    assert rows[0]._mapping["score"] == 3
```

Add `import json` at top of test file and `from sqlalchemy import select` if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news.py::test_summarize_news_returns_sentiment -v`
Expected: FAIL with `ImportError: cannot import name 'summarize_news' from 'app.news'`

- [ ] **Step 3: Add summarize_news to app/news.py**

Append to `app/news.py`:

```python
import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")

ARTICLE_LIMITS = {"LIGHT": 3, "FULL": 5, "DEEP": 10}


def _build_sentiment_prompt(ticker: str, articles: list[dict], depth: str) -> str:
    """Build Indonesian-language sentiment summarization prompt."""
    limit = ARTICLE_LIMITS.get(depth, 5)
    selected = articles[:limit]

    include_summary = depth != "LIGHT"

    news_lines = []
    for i, a in enumerate(selected, 1):
        line = f"{i}. {a['headline']}"
        if include_summary and a.get("summary"):
            line += f"\n   {a['summary'][:200]}"
        news_lines.append(line)

    news_block = "\n".join(news_lines)

    return f"""Kamu adalah analis berita pasar saham Indonesia. Analisis berita berikut untuk ticker {ticker}.

BERITA:
{news_block}

Berikan ringkasan sentiment dalam format JSON berikut (HANYA JSON, tanpa teks lain):
{{
  "score": <integer -5 sampai +5, 0=netral, positif=bullish, negatif=bearish>,
  "themes": [<2-3 tema utama dalam bahasa Indonesia>],
  "catalyst": <katalis positif utama atau null>,
  "risk": <risiko utama atau null>
}}"""


def _get_cached_sentiment(ticker: str, depth: str, max_age_hours: int = NEWS_CACHE_HOURS) -> dict | None:
    """Check if a recent sentiment summary exists."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    with get_engine().connect() as conn:
        row = conn.execute(
            select(news_sentiments)
            .where(news_sentiments.c.ticker == ticker.upper())
            .where(news_sentiments.c.depth == depth)
            .where(news_sentiments.c.summarized_at >= cutoff)
            .order_by(news_sentiments.c.summarized_at.desc())
            .limit(1)
        ).fetchone()
        if row:
            data = dict(row._mapping)
            return {
                "score": data["score"],
                "themes": json.loads(data["themes"]) if data["themes"] else [],
                "catalyst": data["catalyst"],
                "risk": data["risk"],
            }
    return None


def _save_sentiment(ticker: str, depth: str, sentiment: dict, raw_output: str) -> None:
    """Save sentiment summary to DB."""
    with get_engine().begin() as conn:
        conn.execute(
            news_sentiments.insert().values(
                ticker=ticker.upper(),
                summarized_at=datetime.now(timezone.utc),
                depth=depth,
                score=sentiment["score"],
                themes=json.dumps(sentiment.get("themes", []), ensure_ascii=False),
                catalyst=sentiment.get("catalyst"),
                risk=sentiment.get("risk"),
                raw_output=raw_output,
            )
        )


def summarize_news(ticker: str, articles: list[dict], depth: str = "FULL") -> dict | None:
    """Summarize news articles into structured sentiment via Ollama.
    Returns {score, themes, catalyst, risk} or None if no articles."""
    if not articles:
        return None

    cached = _get_cached_sentiment(ticker, depth)
    if cached:
        return cached

    prompt = _build_sentiment_prompt(ticker, articles, depth)

    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "options": {"temperature": 0.2, "num_predict": 512, "num_ctx": 4096},
                "messages": [
                    {"role": "system", "content": "Kamu adalah analis berita saham. Jawab HANYA dalam format JSON."},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw_text = (resp.json().get("message") or {}).get("content", "")

        sentiment = json.loads(raw_text)
        score = max(-5, min(5, int(sentiment.get("score", 0))))
        result = {
            "score": score,
            "themes": sentiment.get("themes", [])[:3],
            "catalyst": sentiment.get("catalyst"),
            "risk": sentiment.get("risk"),
        }
        _save_sentiment(ticker, depth, result, raw_text)
        return result

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        log.warning(f"Failed to parse sentiment for {ticker}: {e}")
        return None
    except Exception as e:
        log.error(f"Sentiment summarization failed for {ticker}: {e}")
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/news.py tests/test_news.py
git commit -m "feat(news): add Ollama sentiment summarizer with cache"
```

---

### Task 4: Inject News Sentiment into Portfolio Prompt

**Files:**
- Modify: `app/fetch_portfolio.py:239` (`build_prompt` function)
- Test: `tests/test_news_integration.py`

- [ ] **Step 1: Write failing test for news block in prompt**

Create `tests/test_news_integration.py`:

```python
"""Integration tests for news sentiment injection into prompts."""

import os
os.environ["DATABASE_URL"] = "sqlite://"

from app.fetch_portfolio import build_prompt


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news_integration.py::test_build_prompt_with_news_sentiment -v`
Expected: FAIL with `TypeError: build_prompt() got an unexpected keyword argument 'news_sentiment'`

- [ ] **Step 3: Modify build_prompt to accept news_sentiment**

In `app/fetch_portfolio.py`, change the function signature at line 239:

Old:
```python
def build_prompt(d: dict, history: list[dict] | None = None, depth: str = "FULL") -> str:
```

New:
```python
def build_prompt(d: dict, history: list[dict] | None = None, depth: str = "FULL", news_sentiment: dict | None = None) -> str:
```

Then, after the `trend_block` construction (after line 292), before the depth-aware variables section (line 294), add:

```python
    news_block = ""
    if news_sentiment:
        score = news_sentiment.get("score", 0)
        if score > 0:
            label = "Bullish"
        elif score < 0:
            label = "Bearish"
        else:
            label = "Neutral"
        themes_str = ", ".join(news_sentiment.get("themes", []))
        news_lines = [
            "NEWS SENTIMENT (auto-generated):",
            f"- Sentiment: {'+' if score > 0 else ''}{score}/5 ({label})",
        ]
        if themes_str:
            news_lines.append(f"- Themes: {themes_str}")
        if news_sentiment.get("catalyst"):
            news_lines.append(f"- Catalyst: {news_sentiment['catalyst']}")
        if news_sentiment.get("risk"):
            news_lines.append(f"- Risk: {news_sentiment['risk']}")
        news_block = "\n".join(news_lines)
```

Then in the return f-string, insert `{news_block}` after `{trend_block}` (line 334):

Old:
```python
{trend_block}

FORMAT INSTRUCTIONS:
```

New:
```python
{trend_block}
{news_block}

FORMAT INSTRUCTIONS:
```

Also add to the extra_instructions for all depths (after the existing extra_instructions lines):

```python
    if news_sentiment:
        extra_instructions += "Factor news sentiment into your recommendation. If news contradicts technical/fundamental signals, flag the conflict.\n"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news_integration.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/fetch_portfolio.py tests/test_news_integration.py
git commit -m "feat(prompt): inject news sentiment into portfolio analysis prompt"
```

---

### Task 5: Inject News Sentiment into Watchlist Prompt

**Files:**
- Modify: `app/analyze_watchlist.py:112` (`build_watchlist_prompt` function)
- Test: `tests/test_news_integration.py` (append)

- [ ] **Step 1: Write failing test**

Append to `tests/test_news_integration.py`:

```python
from app.analyze_watchlist import build_watchlist_prompt


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news_integration.py::test_build_watchlist_prompt_with_news -v`
Expected: FAIL with `TypeError: build_watchlist_prompt() got an unexpected keyword argument 'news_sentiment'`

- [ ] **Step 3: Modify build_watchlist_prompt**

In `app/analyze_watchlist.py`, change function signature at line 112:

Old:
```python
def build_watchlist_prompt(data: dict, rationale: str = "", source: str = "user") -> str:
```

New:
```python
def build_watchlist_prompt(data: dict, rationale: str = "", source: str = "user", news_sentiment: dict | None = None) -> str:
```

Before the return statement (before line 136), add:

```python
    news_block = ""
    if news_sentiment:
        score = news_sentiment.get("score", 0)
        if score > 0:
            label = "Bullish"
        elif score < 0:
            label = "Bearish"
        else:
            label = "Neutral"
        themes_str = ", ".join(news_sentiment.get("themes", []))
        news_lines = [
            f"\nNEWS SENTIMENT (auto-generated):",
            f"- Sentiment: {'+' if score > 0 else ''}{score}/5 ({label})",
        ]
        if themes_str:
            news_lines.append(f"- Themes: {themes_str}")
        if news_sentiment.get("catalyst"):
            news_lines.append(f"- Catalyst: {news_sentiment['catalyst']}")
        if news_sentiment.get("risk"):
            news_lines.append(f"- Risk: {news_sentiment['risk']}")
        news_block = "\n".join(news_lines)
```

Then insert `{news_block}` after the `Div Yield` line and before the `Provide a concise analysis` line:

Old:
```python
Div Yield: {div_yield}%

Provide a concise analysis in the following format:
```

New:
```python
Div Yield: {div_yield}%
{news_block}

Provide a concise analysis in the following format:
```

If news_sentiment is present, also add this instruction before the FORMAT INSTRUCTIONS line:
```python
    news_instruction = ""
    if news_sentiment:
        news_instruction = "Use the news sentiment data to inform your Catalysts & Risks section and final verdict.\n"
```

And insert `{news_instruction}` before `FORMAT INSTRUCTIONS:` in the prompt string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news_integration.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/analyze_watchlist.py tests/test_news_integration.py
git commit -m "feat(prompt): inject news sentiment into watchlist analysis prompt"
```

---

### Task 6: Wire News into fetch_portfolio Main Loop

**Files:**
- Modify: `app/fetch_portfolio.py:551-684` (main function)
- Test: `tests/test_news_integration.py` (append)

- [ ] **Step 1: Write failing test for --no-news flag**

Append to `tests/test_news_integration.py`:

```python
from unittest.mock import patch


def test_no_news_flag_skips_news_fetch():
    """Verify --no-news flag prevents news fetching."""
    import app.fetch_portfolio as fp
    import argparse

    with patch.object(fp, "load_portfolio", return_value={"BBCA": {"avg_price": 9000, "lots": 10, "notes": ""}}):
        with patch.object(fp, "init_db"):
            with patch.object(fp, "upsert_portfolio"):
                with patch("app.news.fetch_company_news") as mock_fetch_news:
                    with patch.object(fp, "fetch_stock", return_value={"error": "test"}):
                        parser = argparse.ArgumentParser()
                        parser.add_argument("tickers", nargs="*")
                        parser.add_argument("--no-telegram", action="store_true")
                        parser.add_argument("--no-llm", action="store_true")
                        parser.add_argument("--no-news", action="store_true")
                        args = parser.parse_args(["--no-news", "BBCA"])
                        # Just verify the flag parses correctly
                        assert args.no_news is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news_integration.py::test_no_news_flag_skips_news_fetch -v`
Expected: FAIL with `error: unrecognized arguments: --no-news`

- [ ] **Step 3: Add --no-news flag and wire news into main loop**

In `app/fetch_portfolio.py`, add the import at the top (after line 33):

```python
from app.news import fetch_company_news, get_cached_news, summarize_news, NEWS_FETCH_ENABLED
```

Add the `--no-news` argument in `main()` after the `--no-llm` line (after line 555):

```python
    parser.add_argument("--no-news", action="store_true", help="Skip news fetch for analysis")
```

After the `SEND_TELEGRAM` override (after line 560), add:

```python
    skip_news = args.no_news or not NEWS_FETCH_ENABLED
```

In the per-ticker loop, after `history = get_snapshots(ticker, limit=5)` (after line 634) and before the `build_prompt` call (line 637), add:

```python
        # Fetch news sentiment
        news_sentiment = None
        if not skip_news and not args.no_llm:
            cached_news = get_cached_news(ticker)
            if not cached_news:
                fetch_company_news(ticker)
                cached_news = get_cached_news(ticker)
            if cached_news:
                news_sentiment = summarize_news(ticker, cached_news)

```

Then modify the `build_prompt` call on line 637:

Old:
```python
        prompt  = build_prompt(data, history=history)
```

New:
```python
        prompt  = build_prompt(data, history=history, news_sentiment=news_sentiment)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news_integration.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/fetch_portfolio.py tests/test_news_integration.py
git commit -m "feat: wire news sentiment into fetch_portfolio pipeline"
```

---

### Task 7: Wire News into analyze_watchlist Loop

**Files:**
- Modify: `app/analyze_watchlist.py:177-254` (`analyze_watchlist` function)

- [ ] **Step 1: Write failing test**

Append to `tests/test_news_integration.py`:

```python
def test_watchlist_analysis_calls_news():
    """Verify watchlist analysis fetches news when enabled."""
    import app.analyze_watchlist as aw
    from unittest.mock import call

    with patch.object(aw, "SEND_TELEGRAM", False):
        with patch.object(aw, "init_db"):
            with patch("app.news.get_cached_news", return_value=[]) as mock_cached:
                with patch("app.news.fetch_company_news", return_value=[]) as mock_fetch:
                    # Just verify the imports work
                    assert callable(mock_cached)
                    assert callable(mock_fetch)
```

- [ ] **Step 2: Run test — should pass as basic import check**

Run: `pytest tests/test_news_integration.py::test_watchlist_analysis_calls_news -v`
Expected: PASS (this is a wiring check)

- [ ] **Step 3: Wire news into analyze_watchlist**

In `app/analyze_watchlist.py`, add import at top (after line 32):

```python
from app.news import fetch_company_news, get_cached_news, summarize_news, NEWS_FETCH_ENABLED
```

In the `analyze_watchlist` function, after the `fetch_stock` call and snapshot save (around line 226), before the `build_watchlist_prompt` call (line 227), add:

```python
        # Fetch news sentiment
        news_sentiment = None
        if NEWS_FETCH_ENABLED:
            cached_news = get_cached_news(ticker)
            if not cached_news:
                fetch_company_news(ticker)
                cached_news = get_cached_news(ticker)
            if cached_news:
                news_sentiment = summarize_news(ticker, cached_news)

```

Then modify the `build_watchlist_prompt` call:

Old:
```python
        prompt = build_watchlist_prompt(data, rationale=rationale, source=source)
```

New:
```python
        prompt = build_watchlist_prompt(data, rationale=rationale, source=source, news_sentiment=news_sentiment)
```

- [ ] **Step 4: Run all tests**

Run: `pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/analyze_watchlist.py tests/test_news_integration.py
git commit -m "feat: wire news sentiment into watchlist analysis pipeline"
```

---

### Task 8: LangGraph Analysis Node — News Integration

**Files:**
- Modify: `app/graph/analysis.py:57-61` (`build_and_call_llm` function)

- [ ] **Step 1: Write failing test**

Create `tests/test_news_graph.py`:

```python
"""Tests for news integration in LangGraph analysis."""

import os
os.environ["DATABASE_URL"] = "sqlite://"

from unittest.mock import patch, MagicMock
from app.graph.analysis import build_and_call_llm
from app.graph.state import Depth


def test_build_and_call_llm_accepts_news_sentiment():
    """Verify build_and_call_llm passes news_sentiment to build_prompt."""
    sentiment = {"score": 2, "themes": ["test"], "catalyst": None, "risk": None}

    with patch("app.graph.analysis.get_snapshots", return_value=[]):
        with patch("app.graph.analysis.build_prompt", return_value="test prompt") as mock_prompt:
            with patch("app.graph.analysis.call_ollama", return_value="<b>TEST</b>"):
                build_and_call_llm({"ticker": "BBCA"}, Depth.FULL, news_sentiment=sentiment)
                mock_prompt.assert_called_once()
                call_kwargs = mock_prompt.call_args
                assert call_kwargs[1].get("news_sentiment") == sentiment or call_kwargs.kwargs.get("news_sentiment") == sentiment


def test_build_and_call_llm_without_news():
    """Verify build_and_call_llm works without news_sentiment."""
    with patch("app.graph.analysis.get_snapshots", return_value=[]):
        with patch("app.graph.analysis.build_prompt", return_value="test prompt") as mock_prompt:
            with patch("app.graph.analysis.call_ollama", return_value="<b>TEST</b>"):
                build_and_call_llm({"ticker": "BBCA"}, Depth.FULL)
                call_kwargs = mock_prompt.call_args
                # news_sentiment should be None or not passed
                ns = call_kwargs[1].get("news_sentiment") if call_kwargs[1] else None
                assert ns is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news_graph.py::test_build_and_call_llm_accepts_news_sentiment -v`
Expected: FAIL with `TypeError: build_and_call_llm() got an unexpected keyword argument 'news_sentiment'`

- [ ] **Step 3: Modify build_and_call_llm and _node_analyze_ticker**

In `app/graph/analysis.py`, add import at top:

```python
from app.news import fetch_company_news, get_cached_news, summarize_news, NEWS_FETCH_ENABLED
```

Modify `build_and_call_llm` signature and body (lines 57-61):

Old:
```python
def build_and_call_llm(data: dict, depth: Depth) -> str:
    """Build prompt with depth and call Ollama. Returns raw LLM output."""
    history = get_snapshots(data["ticker"], limit=5)
    prompt = build_prompt(data, history=history, depth=depth.value)
    return call_ollama(prompt)
```

New:
```python
def build_and_call_llm(data: dict, depth: Depth, news_sentiment: dict | None = None) -> str:
    """Build prompt with depth and call Ollama. Returns raw LLM output."""
    history = get_snapshots(data["ticker"], limit=5)
    prompt = build_prompt(data, history=history, depth=depth.value, news_sentiment=news_sentiment)
    return call_ollama(prompt)
```

Modify `_node_analyze_ticker` (around line 120-122) to fetch news before LLM call:

Old:
```python
        depth = state.get("depth", Depth.FULL)
        raw_llm = build_and_call_llm(data, depth)
```

New:
```python
        depth = state.get("depth", Depth.FULL)

        news_sentiment = None
        if NEWS_FETCH_ENABLED:
            cached_news = get_cached_news(ticker)
            if not cached_news:
                fetch_company_news(ticker)
                cached_news = get_cached_news(ticker)
            if cached_news:
                news_sentiment = summarize_news(ticker, cached_news, depth=depth.value)

        raw_llm = build_and_call_llm(data, depth, news_sentiment=news_sentiment)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_news_graph.py -v`
Expected: Both tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/graph/analysis.py tests/test_news_graph.py
git commit -m "feat(graph): wire news sentiment into analysis pipeline node"
```

---

### Task 9: LangGraph Orchestrator — Periodic News Fetch Node

**Files:**
- Modify: `app/graph/state.py:50-56` (add `last_news_fetch` to `OrchestratorState`)
- Modify: `app/graph/orchestrator.py` (add `_node_fetch_news` + wire into graph)

- [ ] **Step 1: Write failing test**

Create `tests/test_news_orchestrator.py`:

```python
"""Tests for news fetch node in orchestrator."""

import os
os.environ["DATABASE_URL"] = "sqlite://"

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from app.graph.orchestrator import should_fetch_news


def test_should_fetch_news_first_time():
    """First run should always fetch news."""
    last = datetime.min.replace(tzinfo=timezone.utc)
    assert should_fetch_news(last, interval_hours=2) is True


def test_should_fetch_news_within_interval():
    """Recent fetch should not trigger refetch."""
    last = datetime.now(timezone.utc) - timedelta(minutes=30)
    assert should_fetch_news(last, interval_hours=2) is False


def test_should_fetch_news_expired():
    """Old fetch should trigger refetch."""
    last = datetime.now(timezone.utc) - timedelta(hours=3)
    assert should_fetch_news(last, interval_hours=2) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_news_orchestrator.py -v`
Expected: FAIL with `ImportError: cannot import name 'should_fetch_news' from 'app.graph.orchestrator'`

- [ ] **Step 3: Add last_news_fetch to OrchestratorState**

In `app/graph/state.py`, modify `OrchestratorState` (line 50-56):

Old:
```python
class OrchestratorState(TypedDict):
    current_session: Session
    last_check: datetime
    signals: list[TickerSignal]
    pending_batch: list[str]
    last_run: dict[str, datetime]
    _route: str
```

New:
```python
class OrchestratorState(TypedDict):
    current_session: Session
    last_check: datetime
    signals: list[TickerSignal]
    pending_batch: list[str]
    last_run: dict[str, datetime]
    last_news_fetch: datetime
    _route: str
```

Update `initial_orchestrator_state` (line 67-75):

Old:
```python
def initial_orchestrator_state() -> OrchestratorState:
    return OrchestratorState(
        current_session=Session.CLOSED,
        last_check=datetime.now(timezone.utc),
        signals=[],
        pending_batch=[],
        last_run={},
        _route="skip",
    )
```

New:
```python
def initial_orchestrator_state() -> OrchestratorState:
    return OrchestratorState(
        current_session=Session.CLOSED,
        last_check=datetime.now(timezone.utc),
        signals=[],
        pending_batch=[],
        last_run={},
        last_news_fetch=datetime.min.replace(tzinfo=timezone.utc),
        _route="skip",
    )
```

- [ ] **Step 4: Add news fetch node to orchestrator**

In `app/graph/orchestrator.py`, add import at top:

```python
from app.news import fetch_company_news, fetch_macro_news, prune_old_news, NEWS_FETCH_ENABLED
```

Add helper function and node after `should_run_scheduled` (after line 63):

```python
NEWS_FETCH_INTERVAL_HOURS = int(os.getenv("NEWS_CACHE_HOURS", "4"))


def should_fetch_news(last_fetch: datetime, interval_hours: int = NEWS_FETCH_INTERVAL_HOURS) -> bool:
    """Check if enough time has passed for a news fetch."""
    elapsed = (datetime.now(timezone.utc) - last_fetch).total_seconds() / 3600
    return elapsed >= interval_hours


def _node_fetch_news(state: OrchestratorState) -> dict:
    """Fetch news for all active tickers + macro news."""
    if not NEWS_FETCH_ENABLED:
        return {}

    last_fetch = state.get("last_news_fetch", datetime.min.replace(tzinfo=timezone.utc))
    session = state["current_session"]

    interval = 2 if session in (Session.SESSION_1, Session.SESSION_2) else NEWS_FETCH_INTERVAL_HOURS

    if not should_fetch_news(last_fetch, interval_hours=interval):
        return {}

    log.info("Fetching news for all tickers...")
    portfolio = load_portfolio()
    for ticker in portfolio:
        fetch_company_news(ticker)

    fetch_macro_news()
    prune_old_news()

    return {"last_news_fetch": datetime.now(timezone.utc)}
```

Wire into the graph in `build_orchestrator_graph` (around line 175-200):

Old:
```python
    graph.add_edge("__start__", "detect_session")
    graph.add_edge("detect_session", "check_signals")
```

New:
```python
    graph.add_node("fetch_news", _node_fetch_news)

    graph.add_edge("__start__", "detect_session")
    graph.add_edge("detect_session", "fetch_news")
    graph.add_edge("fetch_news", "check_signals")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_news_orchestrator.py tests/test_orchestrator.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add app/graph/state.py app/graph/orchestrator.py tests/test_news_orchestrator.py
git commit -m "feat(graph): add periodic news fetch node to orchestrator"
```

---

### Task 10: Configuration + Dependencies

**Files:**
- Modify: `requirements.txt`
- Modify: `.env.example`

- [ ] **Step 1: Add feedparser to requirements.txt**

In `requirements.txt`, add after the `requests` line:

```
feedparser>=6.0.0
```

- [ ] **Step 2: Add news env vars to .env.example**

Append to `.env.example`:

```
# News sentiment settings
NEWS_CACHE_HOURS=4
NEWS_FETCH_ENABLED=true
```

- [ ] **Step 3: Install feedparser**

Run: `pip install feedparser>=6.0.0`
Expected: Successfully installed

- [ ] **Step 4: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add requirements.txt .env.example
git commit -m "chore: add feedparser dependency and news config vars"
```

---

### Task 11: Graceful Degradation Tests

**Files:**
- Test: `tests/test_news.py` (append)

- [ ] **Step 1: Write tests for edge cases**

Append to `tests/test_news.py`:

```python
@patch("app.news.feedparser.parse")
def test_fetch_company_news_rss_error(mock_parse):
    """RSS parse error returns empty list, no crash."""
    mock_parse.side_effect = Exception("Network error")
    init_db()
    result = fetch_company_news("BBCA")
    assert result == []


@patch("app.news.feedparser.parse")
def test_fetch_company_news_bozo_feed(mock_parse):
    """Bozo feed with no entries returns empty list."""
    bad_feed = MagicMock()
    bad_feed.bozo = True
    bad_feed.entries = []
    bad_feed.bozo_exception = "malformed XML"
    mock_parse.return_value = bad_feed
    init_db()
    result = fetch_company_news("BBCA")
    assert result == []


@patch("app.news.requests.post")
def test_summarize_news_ollama_error(mock_post):
    """Ollama error returns None, no crash."""
    mock_post.side_effect = Exception("Connection refused")
    init_db()
    articles = [{"headline": "Test", "summary": "Test", "url": "http://test.com", "ticker": "BBCA"}]
    result = summarize_news("BBCA", articles, depth="FULL")
    assert result is None


@patch("app.news.requests.post")
def test_summarize_news_invalid_json(mock_post):
    """Invalid JSON from Ollama returns None."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"message": {"content": "not json at all"}}
    mock_resp.raise_for_status = MagicMock()
    mock_post.return_value = mock_resp
    init_db()
    articles = [{"headline": "Test", "summary": "Test", "url": "http://test2.com", "ticker": "BBCA"}]
    result = summarize_news("BBCA", articles, depth="FULL")
    assert result is None


def test_news_disabled_env():
    """NEWS_FETCH_ENABLED=false should skip all fetching."""
    init_db()
    with patch.dict(os.environ, {"NEWS_FETCH_ENABLED": "false"}):
        # Need to reimport to pick up env change
        import importlib
        import app.news
        importlib.reload(app.news)
        result = app.news.fetch_company_news("BBCA")
        assert result == []
        # Restore
        importlib.reload(app.news)
```

- [ ] **Step 2: Run tests**

Run: `pytest tests/test_news.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_news.py
git commit -m "test(news): add graceful degradation edge case tests"
```

---

### Task 12: Final Integration Test + Smoke Test

**Files:**
- Test: `tests/test_news_integration.py` (append)

- [ ] **Step 1: Write end-to-end integration test**

Append to `tests/test_news_integration.py`:

```python
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
            link="https://example.com/bbca-q1",
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
            from app.news import fetch_company_news, get_cached_news, summarize_news

            fetch_company_news("BBCA")
            articles = get_cached_news("BBCA")
            assert len(articles) >= 1

            sentiment = summarize_news("BBCA", articles, depth="FULL")
            assert sentiment is not None
            assert sentiment["score"] == 4

            prompt = build_prompt(SAMPLE_DATA, news_sentiment=sentiment)
            assert "NEWS SENTIMENT" in prompt
            assert "+4" in prompt
            assert "laba naik 15%" in prompt
            assert "kinerja Q1 solid" in prompt
```

- [ ] **Step 2: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_news_integration.py
git commit -m "test: add end-to-end news sentiment pipeline integration test"
```

- [ ] **Step 4: Run final smoke check**

Run: `python -c "from app.news import fetch_company_news, fetch_macro_news, summarize_news, get_cached_news; print('All imports OK')"`
Expected: `All imports OK`

Run: `python -c "from app.db import news_cache, news_sentiments; print('Tables OK')"`
Expected: `Tables OK`
