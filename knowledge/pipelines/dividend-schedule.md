---
type: pipeline
title: dividend schedule
description: Daily IDX + yahoo-sourced dividend schedule sync + ex-date H-1 and pay-date Telegram reminders (three-tier amount display).
resource: app/src/services/dividends.ts
tags: [pipeline, dividends, schedule, reminder]
generated:
  by: human:marvellooni
  at: 2026-07-13T00:00:00Z
status: stable
---

# dividend schedule

`syncDividendSchedules` (`app/src/services/dividends.ts`) consolidates two sources:
- `fetchDividendSchedule` (IDX `GetCompanyProfilesDetail` via `got-scraping`,
  `app/src/providers/idx.ts`) → all four dates (cum/ex/recording/pay) + IDX
  amount per share.
- `fetchDividendAmount` (yahoo trailing-annual `dividendRate` proxy) → backfill
  amount when IDX's is 0 or absent, marked `amount_estimated=true`.

Loads active holdings, calls both per ticker, and upserts
[dividend_schedule](../tables/dividend-schedule.md) on `(ticker, ex_date)`.
**Source-aware upsert**: never overwrites rows where `source = 'manual'` (manual
override preserved). Tickers with no ex-date are skipped; per-ticker failures
log and continue.

`sendDividendReminders` sends two date-driven Telegram messages (each a no-op
when nothing is due, once/day via the runner gate — no sent-flag), with **three
amount-display tiers**:
- **Exact**: `amount_per_share` is not null and `amount_estimated = false`.
- **Estimated** (`~est`): `amount_per_share` is not null but `amount_estimated = true`
  (from yahoo proxy).
- **Unavailable** (⚠️): `amount_per_share` is null.

Messages:
- **ex-date H-1** (`ex_date == tomorrow WIB`): today is the cum date, last day
  to buy to qualify; amount = `amount_per_share × lots × 100` (or tier-appropriate
  label).
- **pay-date** (`pay_date == today WIB`): nudge to record the income in
  [stock_dividends](../tables/stock-dividends.md).

Driven by the [orchestrator runner](orchestrator.md#product-refresh-schedule)
daily at ≥ 08:00 WIB. Mirrors the bond coupon
[schedule + reminder](bond-holdings.md) pattern.

## Related

- IDX fetch lives in `app/src/providers/idx.ts` (`fetchDividendSchedule`).
- Yahoo backfill lives in `app/src/providers/market.ts` (`fetchDividendAmount`).
- No LLM/news; no new bot command (reminders are push-only).
