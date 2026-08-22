---
type: pipeline
title: news sentiment
description: Fetch RSS news, cache it, and summarize per-ticker sentiment via Ollama for injection into analysis prompts.
resource: app/src/services/news.ts
tags: [pipeline, news, rss, sentiment, llm]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# news sentiment

1. `fetch_company_news` / `fetch_macro_news` pull the
   [news RSS feeds](../datasets/news-rss-feeds.md), deduped by URL into
   [news_cache](../tables/news-cache.md).
2. `summarize_news` selects N articles by depth (LIGHT 3 / FULL 5 / DEEP 10),
   prompts Ollama for JSON, and produces the
   [sentiment score](../metrics/sentiment-score.md).
3. Result cached in [news_sentiments](../tables/news-sentiments.md) within
   `NEWS_CACHE_HOURS`; `prune_old_news` deletes stale cache rows.

Gated by `NEWS_FETCH_ENABLED`.

## Related

- Invoked inline by [portfolio-analysis](portfolio-analysis.md),
  [watchlist-analysis](watchlist-analysis.md), and
  [analysis-graph](analysis-graph.md); scheduled by the
  [orchestrator](orchestrator.md).
