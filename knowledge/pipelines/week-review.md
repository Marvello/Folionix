---
type: pipeline
title: week review
description: Weekly retrospective — portfolio WoW numbers across all assets, allocation/concentration, the week's trades/income/fees, upcoming dividend and bond events, recommendation ledger with outcomes, local-LLM self-critique, and a handover doc for external LLMs; delivered via Postgres, email (Brevo), and Telegram.
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
   Per-unit week moves are shown for every gold venue (sell price/g) and fund
   (NAV/unit, in the fund's currency).
2. **Allocation & concentration** — each asset class as a share of net worth,
   the top-5 single holdings (stock / gold venue / fund / bond series), and ⚠️
   flags above 60% per class or 20% per holding — except sovereign bonds
   (SR/ORI/SBR/ST: no issuer risk); corporate bonds (`series_type` CORP) are flagged. Per-holding values come from
   running `aggregatePortfolio` on that holding's rows alone — no second copy
   of the netting/fx math.
3. **Activity** — stock fills ([stock_transactions](../tables/stock-transactions.md)),
   gold/fund buys and sells, income received (dividends, fund distributions,
   bond coupons by `paid_at`) and [account_charges](../tables/account-charges.md),
   filtered by WIB calendar day in (weekStart, weekEnd] so consecutive reviews
   never double-count. Fund amounts are fx-converted; a missing rate shows N/A.
4. **Coming up** — [dividend_schedule](../tables/dividend-schedule.md) ex/pay
   dates for held tickers with the expected payout, bond coupon dates (amount =
   last actual payment, else the `lib/coupon` net estimate) in the next 14 days,
   and bond maturities in the next 90 days.
5. **Recommendation ledger** — the week's [llm_analyses](../tables/llm-analyses.md)
   rows (deduped to `skipped_same = false`), each with price-at-rec vs price-now,
   plus the [recommendation accuracy](../metrics/recommendation-accuracy.md) RPC.
6. **Self-critique** — `callLlm` reviews the recommendations *and* the whole
   portfolio (per-class moves, concentration, whether trades moved allocation
   toward balance, one upcoming event to act on);
   on LLM failure the section notes it is unavailable.
7. **Handover doc** — system description (model, prompt structure, data
   sources, scoring rules), raw ledger + accuracy tables, a sample raw model
   output, and instructions for an external LLM to propose data-source and
   prompt improvements.
8. **Persist + deliver** — save to [weekly_reviews](../tables/weekly-reviews.md);
   send a Telegram summary ping (net worth, asset mix, income/fees, count of
   upcoming events); `stats` also carries `alloc_pct`, `top_holding`,
   `income_week`, `fees_week`, `net_bought_week`, `upcoming_events`; email the report via Brevo SMTP
   (`app/src/services/email.ts`, handover attached as `.md`), marking
   `emailed` on success. The web `/reviews` page lists and renders reports
   and offers copy-to-clipboard for the handover markdown.

## Related

- Numbers reuse the dashboard aggregation extracted into `lib/aggregate.ts`
  (web keeps a verbatim copy at `web/lib/aggregate.ts`, ledger.ts-style).
- First caller of the [recommendation accuracy](../metrics/recommendation-accuracy.md) RPC.
