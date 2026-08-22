---
type: metric
title: news sentiment score
description: LLM-assigned bullish/bearish score (-5..+5) for a ticker's recent news, with themes, catalyst, and risk.
resource: app/src/services/news.ts
tags: [news, sentiment, llm, metric]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# news sentiment score

`news.summarize_news` prompts Ollama for a JSON sentiment over recent articles
and clamps `score` to the integer range -5..+5 (0 = neutral, positive =
bullish, negative = bearish). Also extracts up to 3 `themes`, a `catalyst`, and
a `risk`. Cached per ticker + depth within `NEWS_CACHE_HOURS`.

## Related

- Inputs from [news_cache](../tables/news-cache.md) articles.
- Persisted to [news_sentiments](../tables/news-sentiments.md) and surfaced via
  [news_with_latest_sentiment](../datasets/news-with-latest-sentiment.md).
- Injected into analysis prompts by
  [portfolio-analysis](../pipelines/portfolio-analysis.md) and
  [watchlist-analysis](../pipelines/watchlist-analysis.md).
