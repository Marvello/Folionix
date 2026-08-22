---
type: decision-log
title: Design Decisions
description: Rationale behind implemented features — the "why" distilled from design specs, linking to the live OKF concepts.
---

# Design Decisions

Append-only, newest first. Each entry records the **rationale** behind an
implemented feature — the decisions and rejected alternatives that the
tables/pipelines/metrics concepts and [log.md](log.md) don't capture. The
concepts describe *what* is live; this file records *why*. Distilled from the
design specs that used to live under `docs/superpowers/`.

## 2026-07-13 — dividend schedule + reminders

Concepts: [dividend_schedule](tables/dividend-schedule.md),
[dividend-schedule pipeline](pipelines/dividend-schedule.md).

- **Forecast kept separate from actuals.** Upcoming dividends live in a new
  `dividend_schedule` table, distinct from paid
  [stock_dividends](tables/stock-dividends.md) — forecast data and income
  ledger have different lifecycles and consumers.
- **Source pivot: yahoo → IDX (v2 revision).** The original design sourced
  upcoming dividends from yahoo-finance2. Live testing disproved it: `yf.quote()`
  returns null ex/pay dates for IDX tickers and `quoteSummary` returns only a
  *past* ex-date + null pay-date, so a reminder would never fire. Pivoted to the
  official IDX API (`GetCompanyProfilesDetail`), which returns the full IDX
  4-date schedule (Cum / Ex / Recording / Payment) + per-share amount.
- **got-scraping over curl_cffi.** IDX sits behind Cloudflare. `got-scraping`
  (pure Node) bypasses it — verified live config: `useHeaderGenerator: true`,
  `headerGeneratorOptions.browsers: [{name:'chrome', minVersion:120}]`,
  `http2: true`, `headers.Referer: 'https://www.idx.co.id/'`. Chosen over Python
  `curl_cffi` (adds a second runtime) and `curl-cffi-node` (segfaults on dev arch).
- **Dual-source consolidation.** Yahoo is retained as an *amount backfill*
  (`trailingAnnualDividendRate`) for when IDX's `CashDividenPerSaham` is 0/absent
  — the two sources cover each other's weak spot. Amount tiers surfaced in the
  reminder: exact / `~est` / ⚠️ unavailable.
- **Precedence manual > idx > yahoo.** The daily upsert is source-aware and
  never overwrites a `source='manual'` row — manual override always wins.
- **Migration 022 edited in place**, not superseded — it was never applied to
  any DB, so the yahoo-era version was revised directly.

## 2026-07-09 — stock detail page (position-first)

Component: `web/components/TickerDetail.tsx` (server) +
`web/components/PriceChart.tsx` (client). Route `/stocks?ticker=XXXX`.

- **Reframe around the user's holding.** The old page showed only generic market
  data (fundamentals, sparkline, AI log, news) — nothing about the actual
  position. Rebuilt position-first: lots, avg cost, cost basis, unrealized/
  realized P&L, dividend income, and per-ticker transaction history, above the
  market/AI/news sections.
- **No DB changes.** Pure logic (position metrics, ledger merge, chart-range
  math) extracted into unit-tested `web/lib/` helpers; an interactive SVG
  `PriceChart` client component renders history. Read-only — trading stays on
  `/stocks`.
- **One accent only.** Market up/down via `text-up`/`text-down`; the avg-cost
  chart line is a muted dashed hairline, never a second bright color (see
  [design.md](design.md)).

## 2026-07-08 — transaction ledger + capital/income split

Concepts: [stock_transactions](tables/stock-transactions.md),
[portfolio_positions](tables/portfolio-positions.md),
[realized P&L](metrics/realized-pnl.md),
[stock_dividends](tables/stock-dividends.md),
[fund_distributions](tables/fund-distributions.md).

- **Per-asset transaction tables, not one unified ledger.** Each asset keeps its
  natural shape — stock lots, gold grams, fund units — instead of forcing a
  single polymorphic ledger.
- **Positions become a derived cache.** `stock_transactions` is the source of
  truth; `portfolio_positions` is wholesale-recomputed by a Postgres trigger on
  every write. Writer-agnostic *by design* — the web app writes directly to
  Supabase with no backend API in the path, so the trigger (not app code) must
  own the recompute. All existing readers (snapshots pipeline, bot `/status`,
  web) stay untouched.
- **Weighted-average cost basis.** A SELL never changes `avg_price`; it reduces
  quantity and adds `(sell − avg) × qty` to realized P&L. Later folded per-trade
  fees into cost basis (migration 020).
- **Capital vs Income are separate dimensions.** Capital = price movement
  (mark-to-market vs cost, realized on sell); Income = coupons, distributions,
  dividends. Gold/fund reuse their existing per-purchase tables with a new
  `side` column rather than new tables; stock dividends and fund distributions
  get their own income tables.
- **Additive schema only** on existing tables — never drop/rename a live column,
  so old readers keep working. All new mutations are web-only; the Telegram bot
  stays read-only for sells/dividends/distributions.
