---
type: dataset
title: news_with_latest_sentiment
description: View joining each news_cache row to the latest sentiment for its ticker.
resource: supabase/schema.sql
tags: [supabase, view, news, sentiment]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# news_with_latest_sentiment

Left-joins [news_cache](../tables/news-cache.md) rows to the latest-per-ticker
[news_sentiments](../tables/news-sentiments.md) (`sentiment_score`, `themes`,
`catalyst`, `risk`); sentiment columns are NULL when no summary exists.

## Related

- Read by `db.get_news_with_sentiment` for the web News page.
- Carries the [sentiment score](../metrics/sentiment-score.md) metric.
