# Lessons

## 2026-07-15 — Don't silently revert "drifted" state files at ship time
- During /ship, `.claude/ai-review-state.json` showed `last_processed_id: 2 → null`. I judged it accidental drift and reverted it. It was the user's intentional reset after truncating `weekly_reviews` (2 of 3 rows were broken).
- Rule: a state/config file change I didn't make is user work until proven otherwise. At commit time, either ask, or exclude it from the commit **without reverting the working tree**. `git restore --staged <file>` alone is fine; never follow with `git checkout -- <file>` on files I don't own.

## 2026-10-12 — bigserial ids come back as strings (node-postgres) → strict validators throw
- Bond coupon logging failed with a masked "Minified React error #441" (Next prod wrapper for a server-action error). Real error (web pod log, by digest): `Error: Invalid id`.
- Root cause: all PKs are `bigserial` (int8, OID 20). The web pool (`web/lib/db.ts`) parsed 1082/1114/1184/1700 but NOT int8, so every id arrived as a **string**. It silently works in parameterized SQL (`WHERE id = $1` coerces), which is why gold/stock edits never broke — but `vId` (strict `typeof === 'number'`) threw.
- Fix: `pg.types.setTypeParser(20, (v) => Number(v))` in the web pool. Root-cause fix, aligns runtime with the `id: number` types, fixes every `vId` caller at once.
- Rules: (1) prod React minified errors (#4xx "Server Components render") are wrappers — get the real error from the pod log via its digest, don't guess. (2) When adding a pg pool, parse int8→number alongside numeric, or strict id validators will reject bigserial ids. Vitalix shares this pool pattern — check it has the int8 parser too.
