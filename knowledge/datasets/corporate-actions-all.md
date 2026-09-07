---
type: dataset
title: corporate_actions_all
description: View unioning dividend_schedule and corporate_actions into one timeline, so the UI has a single read path for every corporate action.
resource: db/migrations/039_fundamentals.sql
tags: [postgres, view, corporate-actions, dividends]
generated:
  by: human:marvellooni
  at: 2026-09-07T00:00:00Z
status: stable
---

# corporate_actions_all

Declared `with (security_invoker = true)`, matching every other view in
`db/schema.sql`. Read by the Actions tab of the stock detail page through
`db.getCorporateActions`.

Presents two sources as one date-ordered timeline:

- [dividend_schedule](../tables/dividend-schedule.md) rows appear as
  `type = 'DIVIDEND'`, with `ex_date` as the event date, `amount_per_share` as
  the amount, and `cum_date`, `pay_date` and `amount_estimated` folded into the
  `details` jsonb.
- [corporate_actions](../tables/corporate-actions.md) rows pass through as
  themselves.

## Why dividend_schedule was not migrated

It works, and the Telegram bot's ex-date and pay-date reminders read it. Moving
it would have bought nothing and risked those reminders. Unioning instead keeps
the existing table untouched while the UI still sees one timeline.

This view is the extensibility hinge for the whole feature. When RIGHTS, BONUS
and RUPS find a source, they arrive as inserts into `corporate_actions` with a
new `type`, and neither this view nor the UI changes.

## Related

- Sources: [dividend_schedule](../tables/dividend-schedule.md),
  [corporate_actions](../tables/corporate-actions.md).
