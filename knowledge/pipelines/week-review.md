---
type: pipeline
title: week review
description: Weekly retrospective — portfolio WoW numbers across all assets, recommendation ledger with outcomes, local-LLM self-critique, and a handover doc for external LLMs; delivered via Supabase, email (Brevo), and Telegram.
resource: app/src/services/weekReview.ts
tags: [pipeline, cli, llm, email, telegram, review]
generated:
  by: human:marvellooni
  at: 2026-07-14T00:00:00Z
status: stable
---

# week review

CLI entry `npm run weekreview` (`runWeekReview`); scheduled by the graph
runner every Saturday ≥ 09:00 WIB, or on demand via the `/weekreview` bot
command. `--no-send` skips Telegram + email. Each step is isolated — a
failing step degrades its section instead of aborting the review.

1. **Numbers** — fetch all holdings + latest prices, compute current totals
   with the shared `lib/aggregate.ts` (identical math to the web dashboard),
   then reprice the same holdings at week-ago prices (`getSnapshotBefore`,
   `getGoldPriceBefore`, `getFundNavBefore`) for WoW deltas. Buys/sells made
   during the week are not backed out.
2. **Recommendation ledger** — the week's [llm_analyses](../tables/llm-analyses.md)
   rows (deduped to `skipped_same = false`), each with price-at-rec vs price-now,
   plus the [recommendation accuracy](../metrics/recommendation-accuracy.md) RPC.
3. **Self-critique** — `callLlm` writes a short what-went-right/wrong section;
   on LLM failure the section notes it is unavailable.
4. **Handover doc** — system description (model, prompt structure, data
   sources, scoring rules), raw ledger + accuracy tables, a sample raw model
   output, and instructions for an external LLM to propose data-source and
   prompt improvements.
5. **Persist + deliver** — save to [weekly_reviews](../tables/weekly-reviews.md);
   send a Telegram summary ping; email the report via Brevo SMTP
   (`app/src/services/email.ts`, handover attached as `.md`), marking
   `emailed` on success. The web `/reviews` page lists and renders reports
   and offers copy-to-clipboard for the handover markdown.

## Related

- Numbers reuse the dashboard aggregation extracted into `lib/aggregate.ts`
  (web keeps a verbatim copy at `web/lib/aggregate.ts`, ledger.ts-style).
- First caller of the [recommendation accuracy](../metrics/recommendation-accuracy.md) RPC.
