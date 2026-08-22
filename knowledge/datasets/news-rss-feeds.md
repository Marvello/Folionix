---
type: dataset
title: news RSS feeds
description: External news feed — Google News RSS plus Indonesian financial RSS (Kontan, CNBC Indonesia, Bisnis), per ticker or macro.
resource: app/src/services/news.ts
tags: [news, rss, external, idx]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# news RSS feeds

`news.fetch_company_news` and `news.fetch_macro_news` pull from Google News RSS
(`q=<TICKER>+saham` per company; `IHSG`, `suku bunga BI`, `IDX bursa` for macro)
and three Indonesian feeds: Kontan, CNBC Indonesia, Bisnis. Non-Google feeds are
filtered by ticker mention in the headline. Gated by `NEWS_FETCH_ENABLED`.

The Indonesian term `saham` (stock) is an intentional fetch parameter to target
local-market news, not user-facing text.

## Related

- New articles are deduped by URL into [news_cache](../tables/news-cache.md).
- Summarized into [sentiment](../metrics/sentiment-score.md) by the
  [news-sentiment](../pipelines/news-sentiment.md) pipeline.
