---
type: table
title: stock_key_stats
description: One upserted row per ticker of slow-moving fundamentals - valuation, profitability, financial health, analyst view and ownership.
resource: db/migrations/039_fundamentals.sql
tags: [postgres, fundamentals, yahoo, key-stats]
generated:
  by: human:marvellooni
  at: 2026-09-07T00:00:00Z
status: stable
---

# stock_key_stats

One row per ticker, upserted on `ticker`. Written by
[refresh_fundamentals](../pipelines/fundamentals-refresh.md) via
`db.saveKeyStats`, read by the Overview tab of the stock detail page.

These values move on a quarterly and analyst-driven clock while prices move
every five minutes, which is why they do not live in
[stock_snapshots](stock-snapshots.md). Widening that table would rewrite about
thirty static values on every price tick and bloat the series
`ai/indicators.ts` reads.

## Columns of note

- Valuation: `forward_pe`, `peg_ratio`, `price_to_book`, `enterprise_value`,
  `book_value`, `trailing_eps`, `forward_eps`.
- Profitability: `profit_margins`, `ebitda_margins`, `return_on_equity`,
  `revenue_growth`, `earnings_growth`.
- Health: `current_ratio`, `quick_ratio`, `total_cash`, `total_debt`,
  `free_cashflow`, `operating_cashflow`.
- Street: `target_mean`, `target_high`, `target_low`, `recommendation_key`,
  `analyst_count`.
- Ownership: `shares_outstanding`, `float_shares`, `held_pct_insiders`,
  `held_pct_institutions`, `change_52w`.

Every metric column is nullable and that is load-bearing, not defensive.

## Coverage is uneven by design

Probing five IDX tickers spanning liquidity (BBCA, GOTO, ARTO, HEAL, BSSR)
found 17 fields present on all five, analyst and quarterly data on four, and
nothing at all on BSSR. Thin IDX small-caps genuinely have no analyst coverage.
That is a property of the market, not a bug to engineer around, so the UI drops
an entire stat group when none of its members are populated rather than
rendering a wall of N/A. See `statGroups` in `web/lib/keystats.ts`.

## The currency trap

Yahoo quotes an IDX share price in IDR but reports `bookValue` in the issuer's
**financial** currency. Most IDX coal and mining names report in USD, so the
`priceToBook` yahoo returns divides an IDR price by a USD book value and is
inflated by the exchange rate. Measured live: BSSR came back with a
`priceToBook` of 48529 against a true value of about 3.0, and ADRO with 16875.

`fetchKeyStats` therefore routes `price_to_book` through the pre-existing
`correctPriceToBook` in `app/src/providers/market.ts`, and converts
`book_value` to IDR with the same fx rate. Both become null when no rate is
available, which is better than a number wrong by four orders of magnitude.

`trailing_eps` and `forward_eps` are **not** converted. Yahoo already reports
those in the quote currency. The check that proves it: price divided by
`trailingEps` reproduces yahoo's own published `trailingPE` to four significant
figures for both USD reporters and IDR reporters alike.

## Related

- Refreshed by [fundamentals refresh](../pipelines/fundamentals-refresh.md).
- Sibling tables [stock_financials](stock-financials.md) and
  [corporate_actions](corporate-actions.md).
