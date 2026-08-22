---
type: table
title: news_cache
description: Deduplicated cache of fetched news articles (RSS) per ticker or macro, keyed by unique URL.
resource: supabase/schema.sql
tags: [supabase, news, rss, cache]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# news_cache

Stores articles fetched from RSS sources. `ticker` is NULL for macro-level
news. `url` carries a unique constraint (`uq_news_url`) so concurrent fetches
dedupe atomically. Columns: `source`, `headline`, `summary`, `url`,
`published_at`, `language` (default `id`). Indexes on `fetched_at` and `ticker`.

## Related

- Filled by the [news-rss-feeds](../datasets/news-rss-feeds.md) source through
  `db.save_news_articles`; pruned by `delete_old_news`.
- Joined to latest sentiment in the
  [news_with_latest_sentiment](../datasets/news-with-latest-sentiment.md) view.
- Consumed by the [news-sentiment](../pipelines/news-sentiment.md) pipeline,
  which writes [news_sentiments](news-sentiments.md).
