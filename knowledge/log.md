---
title: Knowledge Bundle Log
description: Dated record of OKF concept drift fixes and sync passes.
---

# Knowledge Bundle Log

Append-only. Newest entries first. Each entry records what drifted in the
codebase and which concept(s) were updated to match.

## 2026-09-07 — Stock detail: key stats, financials, corporate actions

- **Added** `stock_key_stats`, `stock_financials` and `corporate_actions`
  (migration `039`), plus the `corporate_actions_all` view, and the
  `services/fundamentals.ts` daily sweep that fills them. The stock detail page
  became tabbed: Overview, Analysis, Financials, Actions, History.
- **Coverage is uneven by design and this is now written down.** Probing five
  IDX tickers found 17 yahoo fields on all five, analyst and quarterly data on
  four, and nothing on BSSR. Every metric column is nullable; the UI drops an
  empty stat group rather than rendering N/A.
- **Currency trap recorded.** Yahoo quotes IDX prices in IDR but reports
  `bookValue` in the issuer's financial currency, so its `priceToBook` for a USD
  reporter is inflated by the fx rate: BSSR came back as 48,529 against a true
  ~3.0. `price_to_book` now goes through the pre-existing `correctPriceToBook`
  and `book_value` is converted. `trailing_eps` and `forward_eps` are NOT
  converted, because yahoo already reports those in the quote currency - proven
  by price/trailingEps reproducing yahoo's own trailingPE to four significant
  figures.
- **`corporate_actions.ratio` means new shares per old share**: a 1:2 split is
  2.0, a 1:10 reverse split is 0.1.
- **Known gap**: RIGHTS, BONUS and RUPS have no source. IDX's company-detail
  endpoint carries no such keys and three guessed endpoints returned 503. The
  `type` column and the union view exist so they can land later as inserts
  rather than a schema change.
- `dividend_schedule` was deliberately not migrated: it works and the Telegram
  bot's ex-date and pay-date reminders read it.

## 2026-09-07 — Supabase → Postgres doc sync + accuracy metric rewrite

- **Concept drift, long-standing.** Migrations `035_drop_rls` and
  `036_nextauth_tables` moved Folionix off self-hosted Supabase to plain
  Postgres + NextAuth, but the docs never followed. `CLAUDE.md` still described
  `@supabase/supabase-js` / PostgREST, `SUPABASE_*` env vars, an RLS model, and
  a separately-deployed Supabase stack; `README.md` and this bundle agreed with
  it. Reality: `node-postgres` pools over `DATABASE_URL` in both `app/src/db/db.ts`
  and `web/lib/db.ts`, raw SQL, no RLS, `folionix-db` (`postgres:17-alpine`)
  vendored in `docker/docker-compose.yml`.
- **Caught by cost.** The stale docs led to a migration draft ending in
  `revoke execute ... from public, anon` — `anon` no longer exists, so it would
  have aborted on apply. Migration `035` guards its own revokes with a
  `pg_roles` existence check for exactly this reason.
- Updated: `CLAUDE.md`, `README.md`, `index.md`, `tables/index.md`,
  `decisions.md`, `datasets/active-portfolio.md`, `pipelines/week-review.md`,
  and the `supabase` → `postgres` frontmatter tag on 27 concept files.
  `resource:` paths still read `db/...` — that directory name is
  historical and still correct on disk.
- **Renamed** `runbooks/supabase-foundation.md` → `runbooks/postgres-foundation.md`,
  rewritten for the real bootstrap (compose service, `psql -f`, NextAuth user
  creation) with an explicit warning against reintroducing Supabase role grants.
  `db/gen_keys.py` is now dead code and marked as such.
- **`metrics/recommendation-accuracy.md` rewritten** for migration
  `037_accuracy_benchmark_relative`: HOLD-ish recommendations now score against
  `^JKSE` (correct when the ticker tracked the index within `hold_band_pct`,
  default 1.5) instead of an absolute `|move| < 5%` band, and rows carry
  `rec_class` + `benchmark_change_pct`. The old band was near-free at IDX
  volatility — 86% of one week's sample was HOLD-ish scoring 92%, against 33%
  on the six actionable calls, so the blended figure tracked market calm rather
  than skill.

## 2026-07-29 — OKF v0.1 → v0.2 migration

- **Breaking**: `timestamp` field replaced with `generated: { by, at }` block
  across all 52 concept files (tables, datasets, metrics, pipelines). Actor set
  to `human:marvellooni` per v0.2 actor convention.
- **Breaking**: removed `okf_version` from log.md, decisions.md,
  runbooks/supabase-foundation.md — v0.2 spec reserves `okf_version` for the
  bundle-root index.md only.
- **Additive**: `status: stable` added to all concept files.
- **Additive**: `type` field added to decisions.md (`decision-log`),
  runbooks/supabase-foundation.md (`runbook`), design.md (`design-system`) —
  v0.2 requires `type` on every non-reserved .md file.
- **Root**: index.md `okf_version` bumped from `0.1` to `"0.2"`.
- **CLAUDE.md**: updated knowledge bundle reference to OKF v0.2.

## 2026-07-13 — dividend schedule + reminders

- **New table** [dividend_schedule](tables/dividend-schedule.md) (migration
  022) — yahoo-sourced upcoming ex/pay dates + per-share estimate, forecast
  only, separate from paid [stock_dividends](tables/stock-dividends.md).
- **New pipeline** [dividend schedule](pipelines/dividend-schedule.md) —
  `syncDividendSchedules` + `sendDividendReminders` (ex-date H-1 / pay-date),
  daily ≥ 08:00 WIB from the runner; added to the orchestrator schedule table.
- **Provider** `fetchDividendDates` in `app/src/providers/market.ts` (yahoo
  `quote`). cum/recording dates are not available from yahoo (left null).
- Web renders ex/pay cells (Track B); reads the table directly under RLS.

**Revised (Track A v2)**: source pivoted IDX + yahoo consolidation. Fetches all four
dividend dates (cum/ex/recording/pay) from IDX `GetCompanyProfilesDetail` via
`got-scraping` (new provider `app/src/providers/idx.ts`); yahoo
`trailingAnnualDividendRate` backfills amount when IDX amount is 0/null
(`amount_estimated=true`). Added `amount_estimated` and `currency` columns. Upsert is
source-aware: `source='manual'` rows are never overwritten (manual override preserved).
`sendDividendReminders` now displays three amount tiers (exact / `~est` / ⚠️ unavailable).
Updated [dividend_schedule table](tables/dividend-schedule.md) and
[dividend-schedule pipeline](pipelines/dividend-schedule.md) concepts.

## 2026-07-12 — forex, account fees, fee-folding, graph schedule (sync pass)

Migrations reached **021** (last sync verified through 018); audited 019–021
plus two concepts the 07-08 pass missed (`forex_rates`, fund `currency`).

- **Fee-folding drift (migration 020)** — `recompute_stock_position` now folds
  trade fees into cost basis: a BUY raises `avg_price` by its `fee`, a SELL
  subtracts its `fee` from realized P&L, matching the broker net amount.
  Updated [realized P&L](metrics/realized-pnl.md) (resource repointed to
  migration 020), [stock_transactions](tables/stock-transactions.md), and
  [portfolio_positions](tables/portfolio-positions.md) (`avg_price` now
  fee-inclusive).
- **New concept: forex** (migrations 009/010, previously undocumented) — added
  [forex_rates](tables/forex-rates.md) table, [latest_forex_rates](datasets/latest-forex-rates.md)
  view, and [forex-rates pipeline](pipelines/forex-rates.md) (`refreshForexRates`,
  daily ≥ 09:00 WIB + on `fund` refresh). Recorded that migration 010's comment
  says "Finnhub" but the live service uses `open.er-api.com` — comment stale,
  code correct. Added `currency` column to [fund_purchases](tables/fund-purchases.md)
  (migration 009).
- **New concept: account fees** (migration 019) — added
  [account_charges](tables/account-charges.md); dashboard **Total Return =
  Capital + Income − Fees**. Updated the root [flow-at-a-glance](index.md).
- **Graph schedule** — rewrote [orchestrator](pipelines/orchestrator.md) with a
  per-product refresh schedule table (bonds 08:00 / forex 09:00 / funds+gold
  17:00 WIB, on-demand queue by kind), fixed node order and the sleep-tier
  count (2, not 3), and anchored the gold/fund/bond product docs to it.
- **Infra, not an OKF concept:** `schema_migrations` (migration 021 ledger) —
  build/ops tooling, documented in CLAUDE.md → Conventions; deliberately not
  given a table concept.
- **Verified in sync:** 18 base domain tables + `schema_migrations`, 7 views,
  and migrations 001–021 all match their documented concepts.

## 2026-07-08 — transaction ledger + sell + capital/income split (Task 12)

- **New tables**: [stock_transactions](tables/stock-transactions.md)
  (migration 015, append-only BUY/SELL ledger, now the source of truth for
  stock positions), [stock_dividends](tables/stock-dividends.md) (migration
  016, stock dividend income), [fund_distributions](tables/fund-distributions.md)
  (migration 018, fund distribution income).
- **Ownership flip**: [portfolio_positions](tables/portfolio-positions.md) is
  no longer the source of truth for stocks — it's a derived cache, wholesale
  recomputed by the `trg_stock_txn_recompute` trigger
  (`recompute_stock_position`, weighted-average) on every
  `stock_transactions` write. New column `portfolio_positions.realized_pnl`.
- **New column**: `gold_purchases.side` and `fund_purchases.side`
  (migration 017, `BUY` default | `SELL`) — a `SELL` row reuses the
  qty/price columns as the disposal qty/executed sale price. Holdings are
  now netted buys − sells (weighted-average) in `listGoldHoldings`/
  `listFundHoldings` and the web.
- **Updated view**: [fund_product_summary](datasets/fund-product-summary.md)
  (migration 017 supersedes migration 013's version) — nets sells and
  exposes `realized_pnl`.
- **New metric**: [realized P&L](metrics/realized-pnl.md) — same weighted-
  average-on-SELL formula, three independent implementations (Postgres
  trigger for stocks, TypeScript for gold, SQL view for funds). Bonds have
  no realized-P&L concept (no sell path).
- **Surfaced on web**: Capital-vs-Income split on the dashboard — Capital =
  unrealized + realized P&L across stocks/gold/funds; Income = dividends +
  distributions + bond coupons.
- **Writes stay web-only**; the Telegram bot's `/glist`/`/flist` are
  updated to show netted holdings + realized (still read-only for these
  domains — no new bot commands for the ledger, dividends, or distributions).
- **Verified in sync:** 16 tables, 6 views, and the `recommendation_accuracy`
  RPC in `db/schema.sql` (`claim_pending_refresh` lives in migration
  003, not yet folded into `schema.sql`) + migrations 001–018 all match
  their documented concepts.
- **Post-merge re-verification (same day):** three follow-up commits audited
  and found to be presentation- or DDL-mechanics-only, with **no OKF concept
  drift**: `fund_product_summary` now `drop`s before `create` (migration 017,
  to avoid `ERROR 42P16` when superseding migration 013's differently-shaped
  view — columns unchanged, so [fund_product_summary](datasets/fund-product-summary.md)
  is unaffected); the dashboard gained a per-product Income column and
  collapsed its summary cards into one Net Worth / Capital / Income / Total
  Return row — both recorded in `knowledge/design.md`/`CLAUDE.md`, not in the
  data-model concepts.

## 2026-06-23 — funds + bonds (Task 13)

- **New tables**: [fund_catalog](tables/fund-catalog.md) (autocomplete
  universe), [fund_snapshots](tables/fund-snapshots.md) (NAV history),
  [fund_purchases](tables/fund-purchases.md) (holdings, source of truth),
  [bond_holdings](tables/bond-holdings.md) (holdings, source of truth —
  no separate price table). Added by `db/migrations/005_funds_bonds.sql`.
- **New view**: [latest_fund_navs](datasets/latest-fund-navs.md) — newest
  `fund_snapshots` row per fund, mirrors `latest_gold_prices`.
- **New pipelines**: [fund NAVs](pipelines/fund-navs.md)
  (`app.funds.prices.refresh_fund_navs`, provider-per-source, currently
  Cermati REST) and [bond holdings](pipelines/bond-holdings.md)
  (`app.bonds.holdings`, par valuation, no provider/refresh job — bonds
  have no market price feed).
- **Shape**: both new domains mirror gold (tracking-only, no LLM/news) but
  differ in two ways — (1) funds add a `fund_catalog` upsert step that gold
  doesn't need (powers web autocomplete on add), and (2) bonds have no
  provider/snapshot table at all (valued at the user-entered `principal`).
  Both are **web-only for writes**; the bot's `/flist`/`/blist` are
  read-only (no `/fadd`/`/badd`), unlike gold's full `/gadd`/`/gremove`.
- **Verified in sync:** 13 tables, 5 views, and the `recommendation_accuracy`
  RPC in `db/schema.sql` + migrations 001–005 all match their
  documented concepts.

## 2026-06-22 — sync pass

- **[stock_snapshots](tables/stock-snapshots.md)** — added a *Consumers*
  section. The web dashboard reads the raw snapshot history directly (bypassing
  the `latest_snapshots` view) to draw trend sparklines: the ticker-detail page
  (last ~90 rows) and the new `web/lib/history.ts` (last ~40 rows per ticker)
  feeding inline row sparklines on the dashboard/portfolio/watchlist tables.
  Timestamp bumped to 2026-06-22.
- **No other OKF concepts drifted.** The rest of this session's work was
  presentation-layer and does not touch the data model: modal-based CRUD,
  inline sparklines, `IDR` currency code (was `Rp`), focus rings, mobile nav,
  and icon standardization. Those are recorded in `knowledge/design.md`
  (brand component spec + currency rule) and `CLAUDE.md` (conventions), not in
  the tables/datasets/metrics/pipelines concepts.
- **Verified in sync:** 9 tables, 4 views, and the `recommendation_accuracy`
  RPC in `db/schema.sql` (+ migrations 001–004) all match their
  documented concepts. No table/view/RPC added, removed, or renamed.
