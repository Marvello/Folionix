---
type: pipeline
title: analysis graph (inner graph)
description: Inner LangGraph that fans out over tickers — fetch, news, LLM, persist — then sends alerts, invoked by the orchestrator.
resource: app/src/graph/analysis.ts
tags: [pipeline, langgraph, llm, analysis]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# analysis graph (inner graph)

Two nodes: `analyze` then `send_alerts`. For each ticker in the batch:

1. `fetch_and_snapshot` → [stock_snapshots](../tables/stock-snapshots.md).
2. Optional news [sentiment](../metrics/sentiment-score.md).
3. `build_and_call_llm` at the orchestrator-chosen `depth` (`decide_depth`:
   AFTER_HOURS → DEEP, MAJOR signal → FULL, else LIGHT).
4. `process_output` → clean, `extract_recommendation`, duplicate-suppress via
   `alerts.evaluate_alert`, save [llm_analyses](../tables/llm-analyses.md).
5. `send_alerts` posts to Telegram when `GRAPH_SEND_TELEGRAM` is true.

Wraps the same primitives as [portfolio-analysis](portfolio-analysis.md) as
graph nodes.

## Related

- Invoked by the [orchestrator](orchestrator.md) on a routed tick.
