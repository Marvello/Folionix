---
type: pipeline
title: watchlist analysis
description: Same fetch + LLM pipeline over watchlist tickers, producing BUY NOW / WAIT / AVOID verdicts.
resource: app/src/services/watchlist.ts
tags: [pipeline, cli, llm, watchlist, telegram]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# watchlist analysis

CLI entry `npm run watchlist` (`runWatchlistPipeline`). Iterates the
[watchlist](../tables/watchlist.md):

1. [fetchStock](../datasets/yahoo-finance2-market-data.md) → snapshot.
2. Optional news [sentiment](../metrics/sentiment-score.md).
3. `buildPrompt` (with watchlist context) → `callLlm` → clean.
4. `extractRecommendation` → BUY NOW / WAIT / AVOID (emoji-coded).
5. Persist [llm_analyses](../tables/llm-analyses.md); send to Telegram.

## Related

- AI-suggested rows in the watchlist come from `services/watchlist.ts`.
