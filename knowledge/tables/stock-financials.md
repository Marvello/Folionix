---
type: table
title: stock_financials
description: One row per ticker per reporting period - headline quarterly income statement with margins computed at write time.
resource: db/migrations/039_fundamentals.sql
tags: [postgres, fundamentals, yahoo, financials]
generated:
  by: human:marvellooni
  at: 2026-09-07T00:00:00Z
status: stable
---

# stock_financials

Keyed on `(ticker, period_end, period_type)`, so quarters accumulate into a real
trend rather than overwriting. Written by
[refresh_fundamentals](../pipelines/fundamentals-refresh.md) via
`db.saveFinancials`, read by the Financials tab of the stock detail page.

`period_type` is `QUARTERLY` or `ANNUAL`. Only `QUARTERLY` is populated. ANNUAL
exists because `period_type` is part of the key, not as reserved future scope.

## Columns of note

- Line items: `revenue`, `cost_of_revenue`, `gross_profit`,
  `operating_income`, `net_income`, `eps`.
- Margins: `gross_margin_pct`, `operating_margin_pct`, `net_margin_pct`.
- Provenance: `currency`, `source`, `fetched_at`.

Margins are computed on write, not derived at read time, so a later change to
`ai/prompts.ts` can read one column instead of redoing the arithmetic in the
prompt builder.

Margin arithmetic returns null, never Infinity and never NaN, when the
numerator is absent, revenue is absent, or revenue is zero. A loss-making
quarter with zero revenue is a real case in this market.

## Known gaps

`eps` is null for every observed BBCA quarter. Yahoo's
`incomeStatementHistoryQuarterly` does not carry `dilutedEPS` or `basicEPS` for
it. The Financials table therefore renders the EPS column only when at least one
row in the set has a value, the same way `statGroups` drops an empty group.

`currency` records the reporting currency and is surfaced in the UI when it is
not IDR, with an explicit "not converted" note. Unlike the per-share figures in
[stock_key_stats](stock-key-stats.md), these totals are left in their reported
currency and labelled rather than converted.

## Source caveat

`incomeStatementHistoryQuarterly` is formally deprecated by yahoo-finance2,
which steers callers to `fundamentalsTimeSeries`. It returned four quarters for
four of five probed IDX tickers, so it works today. Build the fallback when it
stops, not before.

## Related

- Sibling tables [stock_key_stats](stock-key-stats.md) and
  [corporate_actions](corporate-actions.md).
