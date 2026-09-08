---
type: table
title: corporate_actions
description: Non-dividend corporate actions per ticker - splits today, with rights issues, bonus shares and RUPS reserved.
resource: db/migrations/039_fundamentals.sql
tags: [postgres, corporate-actions, splits, idx]
generated:
  by: human:marvellooni
  at: 2026-09-07T00:00:00Z
status: stable
---

# corporate_actions

Unique on `(ticker, type, event_date)`. Written by
[refresh_fundamentals](../pipelines/fundamentals-refresh.md) via
`db.saveCorporateActions`. Never read directly by the UI, which goes through
the [corporate_actions_all](../datasets/corporate-actions-all.md) view instead.

`type` is one of `SPLIT`, `RIGHTS`, `BONUS`, `RUPS`. Only `SPLIT` is populated.
The other three exist from day one so the IDX-scraped types can land later as
inserts rather than as a schema change.

## ratio means new shares per old share

This is the column most likely to be misread, and getting it backwards would
silently corrupt any future cost-basis adjustment.

- A 1:2 split, where one share becomes two, is `2.0`.
- A 1:10 reverse split, where ten shares become one, is `0.1`.

Yahoo supplies `numerator` and `denominator`, and the stored ratio is
`numerator / denominator`. Verified end to end against BBCA's real October 2021
split, which renders as "1 share becomes 5".

## Known gap: no source for RIGHTS, BONUS or RUPS

Splits come from yahoo's chart events. The other three have no confirmed
source. IDX's `GetCompanyProfilesDetail` endpoint, which this project already
calls for the dividend schedule, returns `Dividen`, `PemegangSaham`,
`BondsAndSukuk` and company-profile keys, but nothing for RUPS, splits or
HMETD. Three guessed IDX endpoints returned 503. KSEI is scraped here only for
bond coupon schedules.

This is a recorded gap, not an oversight. `PemegangSaham`, the 20-row
shareholder register on an endpoint already wired up, is the most promising
unexploited data on that response.

## Related

- Read through [corporate_actions_all](../datasets/corporate-actions-all.md).
- Dividends live separately in [dividend_schedule](dividend-schedule.md).
