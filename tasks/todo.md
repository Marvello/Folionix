# Online-editable settings (no redeploy)

## Goal
Move non-secret tunables from `.env` to a Postgres table editable from the web
dashboard. Precedence: **DB row > `.env` > code default**. Delete row = back to `.env`.

## Scope (user-confirmed)
- Alerts & signals: `SIGNAL_PRICE_MINOR/MAJOR`, `SIGNAL_VOLUME_MINOR/MAJOR`, `SIGNAL_COOLDOWN_MIN`,
  `GOLD_ALERT_PCT`, `BOND_ALERT_MIN_COUPON_PCT`, `SEND_TELEGRAM`
- Recommendation & AI: `REC_STABILITY_PCT`, `REC_MAX_AGE_HOURS`, `PERSONAS`, `DEEP_RUNS_ENABLED`,
  `CONSENSUS_MIN_PERSONAS`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`
- Schedules: `GRAPH_ANALYSIS_INTERVAL`, `GOLD_REFRESH_HOURS`, `FUNDAMENTALS_HOUR_WIB`,
  `BOND_REG_CHECK_HOURS_WIB`, `CACHE_MINUTES`
- Out: secrets/infra (DB, auth, tokens, API keys/base URLs, SMTP, cookies), housekeeping.
- Note: `NEWS_CACHE_HOURS` / `NEWS_FETCH_ENABLED` are documented but **not read anywhere** →
  drop from CLAUDE.md, don't add.

## Design
- [x] `db/migrations/051_app_settings.sql`: `app_settings(key text PK, value text NOT NULL,
      updated_at timestamptz default now(), updated_by text)`.
- [x] `lib/settings.ts` (shared app+web): `SETTINGS` registry `{ key, group, type: number|bool|hours|personas|text, min?, max?, help }`
      + pure `validateSetting(key, raw) → string | error`. Single whitelist for both sides.
- [x] `app/src/config/settings.ts`: `syncSettings()` — snapshot original `process.env` once,
      read `app_settings`, overlay whitelisted keys onto `process.env`, restore snapshot for
      removed rows. `startSettingsSync()` = await once + `setInterval(60s).unref()`; DB error → keep last values, warn.
- [x] Call `startSettingsSync()` at boot in `runner.ts`, `worker.ts`, `bot.ts` (one line each).
- [x] Turn module-level consts into per-call reads (otherwise frozen at boot):
      `market.ts` CACHE_MINUTES, `portfolio.ts` REC_* + SEND_TELEGRAM, `gold.ts` GOLD_ALERT_PCT + SEND_TELEGRAM,
      `deepRun.ts` SEND_TELEGRAM, `runner.ts` BOND_REG_CHECK_HOURS_WIB / FUNDAMENTALS_HOUR_WIB / GOLD_INTERVAL_MS.
      LLM_MODEL: check `llm.ts` builds the model per call, not cached.
- [x] Web `/settings` page (Server Component, grouped form, shows effective value + source DB/env/default)
      + Server Actions `saveSetting` / `resetSetting` in `web/app/actions.ts` → `requireSession()` +
      `validateSetting()`; `updated_by` = session email. Nav link.
- [x] Tests: `lib/settings.test.ts` (validation), `syncSettings` overlay/restore test, action test.
- [x] Docs: CLAUDE.md Key Configuration (mark DB-overridable keys), knowledge/, common-tech memory.

## Behaviour notes
- Changes apply ≤60s in runner/worker/bot. No restart.
- Web reads DB directly for display; only the app processes consume overlay.
- Bad value in DB can't happen (validated on write); overlay still re-validates and skips invalid rows.

## Review (2026-10-19)
- Done as planned. 20 settings, each with plain-language help + example where useful; cross-checks
  (minor < major thresholds; min persona votes ≤ enabled personas) enforced on save.
- Verified: app tsc + 387 tests, lib 5 settings tests, web tsc + 67 tests + `next build`; migration 051
  applied on a throwaway Postgres 18 (`migrate --check` clean); live overlay test (DB wins, non-whitelisted
  ignored, delete → .env value back); browser: page renders, invalid save shows error in dialog, valid save
  persists with editor email, reset deletes row.
- Found + fixed pre-existing bug: shared `Modal` re-ran its focus effect on every render (inline `onClose`),
  so after the first keystroke focus jumped to ✕ in every add/edit dialog app-wide.
- Corrected help text vs first draft after reading code: REC_STABILITY_PCT also gates signal-triggered
  analyses; SEND_TELEGRAM does not gate dividend/coupon reminders or the weekly review ping;
  CACHE_MINUTES only affects analysis fetches (price refresh always forces).
- Not done: one-shot CLIs (`npm run portfolio`, …) don't sync settings; knowledge docs still cite unused
  NEWS_CACHE_HOURS / NEWS_FETCH_ENABLED (logged in knowledge/log.md).

---

# New corporate bond alert — high-coupon only (KSEI new-securities registration)

## Goal
Daily check of KSEI "Pendaftaran Efek Baru"; when a **new corporate bond / sukuk / NCD**
is registered, read its coupon from the registration PDF and push a Telegram alert
**only if the top tranche coupon > 9%** (`BOND_ALERT_MIN_COUPON_PCT`, default 9).
Dedup per KSEI ref no. No web page. Govt retail SBN out of scope.

## Confirmed by spike
- Page `https://web.ksei.co.id/publications/new-securities-registration` is server-rendered
  HTML (53 KB). Rows carry ref no, date, title, and a relative PDF href
  `/Announcement/Files/....pdf` (host = web.ksei.co.id; NOT www). Plain `fetch` + Chrome UA works.
- The registration PDF **contains per-series coupon**, cleanly:
  `A Rp918.465.000.000,- 10.00 % p.a ... 3 Tahun` / `B ... 10.50 % p.a ... 5 Tahun`.
  Sukuk uses "Bagi Hasil Per Tahun (Ekuivalen)". Extractable with `unpdf` + regex.

## Decisions (user)
- Coupon source = registration PDF; take **max tranche rate**; alert if `> 9%`.
- **Unparsed coupon → alert anyway, flagged "coupon unknown"** (never miss a high-yield bond).
- PDF text via **`unpdf`** (pure-JS pdfjs; one new dep in `app/package.json`).

## Design
### Provider — `app/src/providers/ksei.ts` (add to existing module)
- `fetchNewSecurities(): Promise<NewSecurityRef[]>` — GET page, parse list. Pure
  `parseNewSecurities(html): NewSecurityRef[]`. `NewSecurityRef = { ref, date (ISO), title, pdfUrl (absolute), kind }`.
  Reuses module FETCH_HEADERS + `withRetry` + `[]`-on-error.
- `classifyBondTitle(title): 'OBLIGASI'|'SUKUK'|'NCD'|null` — keyword match; rejects
  Waran / Produk Investasi / S-INVEST / Reksa Dana (unless a bond keyword is also present).
- `fetchCoupon(pdfUrl): Promise<number | null>` — download PDF (arrayBuffer) → `unpdf` extractText
  → pure `parseCouponRates(text): number[]` → `max` (null if none). Never throws (null on any failure).

### Migration — `db/migrations/0NN_bond_registrations.sql`
`bond_registrations(ref text primary key, title text, kind text, registered_at date,
coupon_pct numeric, pdf_url text, seen_at timestamptz default now())`.
Ends with the `schema_migrations` insert; no BEGIN/COMMIT. (NN = next after current highest.)

### DB — `app/src/db/db.ts`
- `selectKnownRegistrationRefs(refs): Promise<Set<string>>` — which refs already stored.
- `insertBondRegistration(rec)` — `ON CONFLICT (ref) DO NOTHING`.
- `countBondRegistrations(): number` — for the first-run guard.

### Service — `app/src/services/bonds.ts`
`checkNewBondRegistrations()`:
1. `fetchNewSecurities()` → bond-kind refs only.
2. First-run guard: if table empty → insert all (coupon null, **no PDF fetch, no alert**), log, return.
3. Else diff vs known refs. For each new ref: `fetchCoupon(pdfUrl)`; insert row (store coupon_pct).
4. Alert (gated by `SEND_TELEGRAM`) when `coupon_pct == null` (flag "coupon unknown") OR `coupon_pct > BOND_ALERT_MIN_COUPON_PCT`.
   Message: `🆕 <b>New bond ≥9%</b>\n{title}\n{kind} · coupon {pct}% · reg {date}\n{pdfUrl}` (all escaped);
   unknown variant: `coupon unknown — check PDF`.

### Runner — `app/src/graph/runner.ts`
Run twice daily at **09:00 and 15:00 WIB** (`BOND_REG_CHECK_HOURS_WIB`, default `9,15`).
Latch per (date, slot): `scheduled_runs` job name `bond-reg-<HH>` + today's WIB date, plus an
in-memory latch, mirroring the existing bond/dividend jobs. Fire a slot when WIB hour ≥ slot
hour and that slot isn't latched for today. (Twice-daily is safe — dedup is by ref no, so the
15:00 pass only alerts registrations posted after 09:00.)

### Build — `app/build.mjs`
Add `unpdf`; if esbuild can't bundle pdfjs cleanly, mark `unpdf` external (present in the
runner image's `app/node_modules`). Verify `npm run build`.

### Docs/memory
CLAUDE.md (bonds service line + `BOND_ALERT_MIN_COUPON_PCT` / `BOND_REG_CHECK_HOURS_WIB` env),
`common-tech/memory` note if durable, graphify update.

## Testing (TDD)
- `parseNewSecurities` vs saved `ksei_page.html` fixture → exact refs/titles/absolute pdf urls.
- `classifyBondTitle` — Obligasi/Sukuk/NCD accept; Waran/S-INVEST/Reksa Dana reject.
- `parseCouponRates` vs saved pindo PDF-text fixture → `[10.0, 10.5]`; rejects non-rate numbers; sukuk equivalent.
- service (mock db + provider + sendTelegram, like `dividends.test.ts`): first-run seeds silent;
  next run alerts only >9% and unknown, never ≤9%.
- typecheck + full vitest + `npm run build` + `migrate --check`.

## Out of scope
Govt retail SBN; web page; parsing nominal/tenor beyond what the alert shows.

## Review
Done (TDD). RED→GREEN on all three pure parsers + the service orchestration.
- `providers/ksei.ts`: `parseNewSecurities`, `classifyBondTitle`, `parseCouponRates` (pure),
  `fetchNewSecurities`, `fetchCoupon` (unpdf). 9 new tests vs real markup/PDF-text fixtures.
- `db/db.ts`: `countBondRegistrations`, `selectKnownRegistrationRefs`, `insertBondRegistration`.
- `services/bonds.ts`: `checkNewBondRegistrations` (first-run seeds silent; alerts only >9% or unknown). 4 tests.
- `db/migrations/050_bond_registrations.sql`.
- `graph/runner.ts`: twice-daily latch `bond-reg-<HH>` for `BOND_REG_CHECK_HOURS_WIB` (9,15).
- Dep `unpdf`. Docs: CLAUDE.md (service line, env, table list, provider note).
- Verified: typecheck clean, full suite 379 passed (+11), `npm run build` clean (unpdf bundles).
  `migrate --check` not runnable locally (no DATABASE_URL; prod DB cluster-internal) — CI validates.
- Threshold is strict `>` 9%, so an exactly-9.0% bond does not alert (matches "more than 9%").
