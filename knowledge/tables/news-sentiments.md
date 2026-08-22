---
type: table
title: news_sentiments
description: LLM-summarized news sentiment per ticker and analysis depth — score, themes, catalyst, and risk.
resource: supabase/schema.sql
tags: [supabase, news, sentiment, llm]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# news_sentiments

One row per sentiment summarization. Keyed by `ticker` + `depth`
(LIGHT/FULL/DEEP) + `summarized_at`. Stores the
[sentiment score](../metrics/sentiment-score.md) (`score`, integer -5..+5),
`themes` (JSON array as text), `catalyst`, `risk`, and `raw_output`. Indexes on
`ticker` and `summarized_at`.

## Related

- Produced by the [news-sentiment](../pipelines/news-sentiment.md) pipeline from
  [news_cache](news-cache.md) articles via Ollama.
- The latest row per ticker surfaces through the
  [news_with_latest_sentiment](../datasets/news-with-latest-sentiment.md) view.
