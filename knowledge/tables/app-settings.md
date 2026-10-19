---
type: table
title: app_settings
description: Runtime-editable tunables (thresholds, schedules, toggles) set from the web /settings page; a row overrides the matching .env variable.
resource: db/migrations/051_app_settings.sql
tags: [postgres, config, settings]
generated:
  by: human:marvellooni
  at: 2026-10-19T00:00:00Z
status: stable
---

# app_settings

One row per overridden setting: `key` (PK, the env-var name), `value` (text,
already normalised), `updated_at`, `updated_by` (editor's email). No row = the
`.env` value applies, else the built-in default.

- **Whitelist + validation + help text**: `lib/settings.ts` (`SETTINGS`,
  `validateSetting`, `validateCombination`) — shared by web and app. Only
  non-secret tunables; secrets/URLs/tokens never go here.
- **Written by** the web `/settings` page (`saveSetting` / `resetSetting` in
  `web/app/actions.ts`, session-gated, validated server-side).
- **Read by** `app/src/config/settings.ts`: runner, worker and bot overlay the
  rows onto `process.env` at boot and every 60s, so edits apply within a
  minute without a restart. Invalid rows are skipped; deleting a row restores
  the boot-time `.env` value. One-shot CLI runs (`npm run portfolio`, …) do not
  read it.

## Related

- [market signal](../metrics/market-signal.md) — `SIGNAL_*` thresholds live here
- [orchestrator](../pipelines/orchestrator.md) — schedules (`GRAPH_ANALYSIS_INTERVAL`, gold/fundamentals/bond-check times)
