# News Sentiment Integration — Design Spec

**Date:** 2026-04-29
**Status:** Draft
**Goal:** Add external news data (company-specific + macro) to improve LLM analysis prediction quality.

---

## Overview

Two-stage news pipeline: fetch headlines from free sources → LLM summarizes into structured sentiment → inject into existing analysis prompts. Periodic fetch with SQLite cache. Fully backward-compatible — analysis runs unchanged if news unavailable.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| News scope | Company-specific + macro | Both matter for IDX retail investing |
| Sources | Google News RSS (macro) + Indonesian financial RSS (company) | Free, good IDX coverage, Indonesian language matches prompts |
| Freshness | Periodic (every 2-4 hours), cached locally | Decouples news gathering from analysis pipeline |
| LLM integration | Two-stage (summarize → inject) | Cleaner signal than raw headline dump |
| News volume | Adaptive by depth (LIGHT=3, FULL=5, DEEP=10) | Matches existing depth parameter pattern |
| Database | SQLite (existing) | Single-process, no need for PostgreSQL yet |

---

## 1. Data Layer

### New SQLite table: `news_cache`

| Column | Type | Purpose |
|--------|------|---------|
| id | Integer PK | Auto-increment |
| fetched_at | DateTime | When fetched (UTC) |
| ticker | String(10), nullable | Null = macro news |
| source | String(50) | "google_news", "cnbc_id", "kontan", "bisnis" |
| headline | String(500) | Article title |
| summary | Text, nullable | Article snippet/description |
| url | String(500) | Source URL |
| published_at | DateTime, nullable | Article publish time |
| language | String(5) | "id" or "en" |

### New SQLite table: `news_sentiments`

| Column | Type | Purpose |
|--------|------|---------|
| id | Integer PK | Auto-increment |
| ticker | String(10) | Ticker analyzed |
| summarized_at | DateTime | When sentiment was generated (UTC) |
| depth | String(10) | LIGHT/FULL/DEEP |
| score | Integer | -5 to +5 sentiment score |
| themes | Text | JSON array of key themes |
| catalyst | Text, nullable | Notable positive catalyst |
| risk | Text, nullable | Notable risk |
| raw_output | Text | Full Ollama response |

### Cache policy

- Keep 7 days of articles, auto-prune on each fetch cycle.
- Dedup by URL — skip if URL already exists in cache.
- Sentiments valid for duration of `NEWS_CACHE_HOURS` (default 4).

---

## 2. News Fetch Module

### New module: `app/news.py`

**Core functions:**

```python
def fetch_company_news(ticker: str) -> list[dict]:
    """Fetch company-specific news from Google News RSS + Indonesian RSS.
    Queries: '{ticker} saham' on Google News, ticker mention on Kontan/CNBC/Bisnis.
    Returns list of {headline, summary, url, published_at, source, language}.
    Writes to news_cache table. Deduplicates by URL."""

def fetch_macro_news() -> list[dict]:
    """Fetch macro/market news.
    Google News queries: 'IHSG', 'suku bunga BI', 'IDX bursa'.
    Indonesian RSS: market sections from Kontan, CNBC Indonesia, Bisnis.
    Returns list of articles. Writes to news_cache with ticker=None."""

def get_cached_news(ticker: str | None, max_age_hours: int = 4) -> list[dict]:
    """Read cached news from news_cache table.
    ticker=None returns macro news. Filters by max_age_hours."""

def summarize_news(ticker: str, articles: list[dict], depth: str = "FULL") -> dict | None:
    """Two-stage: select articles by depth, call Ollama for structured sentiment.
    Returns {score: int, themes: list[str], catalyst: str|None, risk: str|None}
    or None if no articles available. Caches result in news_sentiments table."""
```

### News sources

| Source | Type | Query | Notes |
|--------|------|-------|-------|
| Google News RSS | Company + Macro | `{ticker} saham`, `IHSG`, `suku bunga BI` | Indonesian locale (`hl=id&gl=ID`) |
| Kontan RSS | Company + Macro | Market section feed | Filter by ticker/sector keywords |
| CNBC Indonesia RSS | Company + Macro | Market/stock section feed | Filter by ticker/sector keywords |
| Bisnis.com RSS | Company + Macro | Market section feed | Filter by ticker/sector keywords |

**Fallback chain:** Google News → Indonesian RSS → skip. If all sources fail, return empty list — analysis proceeds without news.

**Rate limiting:** 1-2 second delay between RSS requests per source.

### New dependency

`feedparser` added to `requirements.txt`.

---

## 3. Sentiment Summarizer

### Ollama sentiment prompt

Indonesian-language prompt. Input: headlines + summaries (count based on depth). Output: structured sentiment.

**Depth-adaptive article selection:**

| Depth | Company headlines | Include summaries? | Macro news? |
|-------|-------------------|--------------------|-------------|
| LIGHT | 3 | No | No |
| FULL | 5 | Yes | No |
| DEEP | 10 | Yes | Yes (3-5 macro headlines) |

### Sentiment output format

```json
{
  "score": 3,
  "themes": ["earnings beat expectations", "sector rotation into banking"],
  "catalyst": "BI rate cut expected next month",
  "risk": "foreign fund outflow accelerating"
}
```

Score scale: -5 (very bearish) to +5 (very bullish). 0 = neutral.

### Caching

Result stored in `news_sentiments` table. Valid for `NEWS_CACHE_HOURS`. Avoids redundant LLM calls within same fetch cycle. Keyed by (ticker, depth) — different depths may produce different summaries.

---

## 4. Prompt Integration

### Portfolio prompt (`build_prompt`)

**New parameter:** `news_sentiment: dict | None = None`

**Injected block** (after `trend_block`, before `FORMAT INSTRUCTIONS`):

```
NEWS SENTIMENT (auto-generated):
- Sentiment: +3/5 (Moderately Bullish)
- Themes: [theme1], [theme2]
- Catalyst: [catalyst text]
- Risk: [risk text]
```

**New LLM instruction** added to prompt: "Factor news sentiment into your recommendation. If news contradicts technical/fundamental signals, flag the conflict."

### Watchlist prompt (`build_watchlist_prompt`)

**New parameter:** `news_sentiment: dict | None = None`

Same news block, injected before format instructions. Existing "Catalysts & Risks" section now informed by real data.

### Backward compatibility

Both functions accept `news_sentiment=None` (default). When None, no news block injected — existing behavior unchanged. All current callers work without modification.

---

## 5. Fetch Schedule & Integration Points

### LangGraph orchestrator (`app/graph/`)

**New node: `fetch_news_node`**

Runs on its own timer within the graph runner:
- Every 2 hours during market hours (09:00-15:00 WIB)
- Every 4 hours outside market hours
- Fetches news for all active portfolio + watchlist tickers in one batch
- Writes to `news_cache` table

**Analysis graph modification (`app/graph/analysis.py`):**

Before `build_and_call_llm()`:
1. Read cached news from `news_cache` (within `NEWS_CACHE_HOURS`)
2. If stale or empty, trigger fresh fetch for that ticker
3. Call `summarize_news()` → get sentiment dict
4. Pass to `build_prompt()` / `build_watchlist_prompt()`

### Manual runs (`python -m app.fetch_portfolio`)

News fetched inline before each ticker's analysis. New CLI flag:
- `--no-news` — skip news fetch (mirrors `--no-llm`, `--no-telegram`)

### Bot integration

`/analyze` command triggers `fetch_portfolio` for specific tickers. News fetch happens automatically as part of pipeline. No new bot commands needed.

### New environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEWS_CACHE_HOURS` | `4` | Max news cache age before refetch |
| `NEWS_FETCH_ENABLED` | `true` | Kill switch for news feature |

---

## 6. Testing

| Test | Type | What it verifies |
|------|------|------------------|
| RSS parsing | Unit | `fetch_company_news` / `fetch_macro_news` parse mock RSS correctly |
| Cache write/read | Unit | Articles written to `news_cache`, read back with age filter |
| Dedup | Unit | Duplicate URLs not inserted |
| Sentiment summarizer | Unit | Mock Ollama response → structured dict output |
| Depth selection | Unit | Correct article count per depth level |
| Prompt injection (portfolio) | Unit | News block appears in prompt at correct position |
| Prompt injection (watchlist) | Unit | News block appears in watchlist prompt |
| No news fallback | Unit | `news_sentiment=None` → prompt unchanged |
| Cache expiry | Unit | Stale articles filtered out correctly |
| CLI flag | Integration | `--no-news` skips news fetch |

---

## File Changes Summary

| File | Change |
|------|--------|
| `app/news.py` | **New** — fetch, cache, summarize functions |
| `app/db.py` | Add `news_cache` + `news_sentiments` tables |
| `app/fetch_portfolio.py` | Add `news_sentiment` param to `build_prompt`, fetch news before LLM call, add `--no-news` flag |
| `app/analyze_watchlist.py` | Add `news_sentiment` param to `build_watchlist_prompt`, fetch news before LLM call |
| `app/graph/analysis.py` | Add news fetch step before LLM call |
| `app/graph/orchestrator.py` | Add `fetch_news_node` on periodic timer |
| `app/graph/state.py` | Add news-related state fields |
| `requirements.txt` | Add `feedparser` |
| `.env.example` | Add `NEWS_CACHE_HOURS`, `NEWS_FETCH_ENABLED` |
| `tests/test_news.py` | **New** — unit + integration tests |
