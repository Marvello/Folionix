---
type: table
title: dividend_schedule
description: IDX + yahoo-sourced upcoming dividend schedule per held stock — all four dividend dates from IDX with amount backfill from yahoo; manual override preserved. Forecast only, separate from paid actuals in stock_dividends.
resource: supabase/migrations/022_dividend_schedule.sql
tags: [supabase, dividends, schedule, forecast]
generated:
  by: human:marvellooni
  at: 2026-07-13T00:00:00Z
status: stable
---

# dividend_schedule

Upcoming dividends per held ticker, dual-sourced: all four dates from IDX
`GetCompanyProfilesDetail` via `got-scraping`, with amount backfilled from
yahoo's trailing **annual** `dividendRate` when IDX's amount is 0 or absent
(flagged `amount_estimated=true`). One row per `(ticker, ex_date)` (upsert key).

**Columns**: `cum_date` (IDX `TanggalCum`), `ex_date` (IDX
`TanggalExRegulerDanNegosiasi`, not null), `recording_date` (IDX `TanggalDPS`),
`pay_date` (IDX `TanggalPembayaran`, nullable), `amount_per_share` (IDX
`CashDividenPerSaham` else yahoo proxy — may remain null), `amount_estimated`
(true when filled from yahoo, over-states interim payouts), `currency` (IDX
`CashDividenPerSahamMU`, defaults to `IDR`), `source` (`idx` | `manual`,
default `idx`), `synced_at`. Indexes on `ex_date` and `pay_date`.

**Forecast only** — IDX rows are refreshed on each sync; manual rows are never
overwritten. Distinct from [stock_dividends](stock-dividends.md) (paid actuals,
Income figure). Display status is derived on read from `ex_date`/`pay_date` vs
today (Upcoming / Ongoing / Paid), not stored.

**RLS**: authenticated read + write (manual override path); service role bypasses.

## Related

- Populated + read by the [dividend-schedule pipeline](../pipelines/dividend-schedule.md)
  (sync + ex-date H-1 / pay-date reminders, three-tier amount display).
- Web reads it directly under RLS to show ex/pay dates in the portfolio table and
  detail card; manual rows can be added via the API.
