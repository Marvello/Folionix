---
type: pipeline
title: portfolio analysis
description: Per-position pipeline — fetch market data, summarize news, run the LLM, suppress duplicate alerts, persist, and send a Telegram summary.
resource: app/src/services/portfolio.ts
tags: [pipeline, cli, llm, telegram]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# portfolio analysis

CLI entry `npm run portfolio [TICKERS]` (`runPortfolioPipeline`). For each active position:

1. [fetchStock](../datasets/yahoo-finance2-market-data.md) → save
   [stock_snapshots](../tables/stock-snapshots.md) (skipped on cache hit).
2. Fetch/cache news and compute the [sentiment score](../metrics/sentiment-score.md).
3. `buildPrompt` (with 5-row history + sentiment) → `callLlm` →
   clean → `extractRecommendation`.
4. Duplicate suppression via `evaluateAlert` (send only on changed
   recommendation, first time, or a new WIB day).
5. Save [llm_analyses](../tables/llm-analyses.md); send Telegram alert + an
   end-of-run portfolio P&L summary.

## Related

- Reads the [active portfolio](../datasets/active-portfolio.md) dataset.
- Sums [unrealized P&L](../metrics/unrealized-pnl.md) for the summary.
- The long-running [analysis-graph](analysis-graph.md) wraps these same steps as
  graph nodes.
