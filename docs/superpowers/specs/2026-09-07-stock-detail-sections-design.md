# Stock Detail: Key Stats, Financial Reports, Corporate Actions

Date: 2026-09-07
Status: approved, not yet planned

## Problem

The stock detail page answers "what do I own and what is it doing" and
nothing else. It shows Position, Price History, Transactions, a flat
12-cell Fundamentals grid, and Recommendation Accuracy. To judge whether
a position is still worth holding you leave the app: earnings trend,
analyst view, ownership, upcoming dividends and splits all live
elsewhere.

Three additions close that gap: **Key Stats** (a richer, grouped
replacement for Fundamentals), **Financial Reports** (headline quarterly
trend), and **Corporate Actions** (dividends, splits, and later the
IDX-scraped types).

Adding three sections to a page that already runs five would make it a
scroll. So the page also gains a tab layout, which is the structural
half of this work.

## Source of truth and coverage

All new market data comes from `yahoo-finance2`, already a dependency.
Coverage was measured, not assumed - probed across five held/watchlist
tickers chosen to span liquidity (BBCA, GOTO, ARTO, HEAL, BSSR):

| Coverage | Fields |
|---|---|
| 5/5 | `trailingEps` `totalDebt` `totalCash` `sharesOutstanding` `revenueGrowth` `returnOnEquity` `recommendationKey` `profitMargins` `priceToBook` `operatingCashflow` `heldPercentInstitutions` `heldPercentInsiders` `floatShares` `enterpriseValue` `ebitdaMargins` `bookValue` `52WeekChange` |
| 4/5 | `targetMeanPrice` `targetHighPrice` `targetLowPrice` `numberOfAnalystOpinions` `forwardPE` `forwardEps` `earningsGrowth` |
| 3/5 | `pegRatio` `currentRatio` `quickRatio` `freeCashflow` |
| 2/5 | `debtToEquity` |

BSSR is the consistent miss: no analyst coverage and no quarterly
statements. That is a real property of thin IDX small-caps, not a bug to
engineer around. Every metric column is therefore nullable and the UI
renders a short card rather than a wall of N/A.

`debtToEquity` stays sourced from the existing `stock_snapshots` path,
which covers it better than `financialData` does.

Two provider details that are load-bearing:

- **`validateResult: false` on every quoteSummary call.** Strict schema
  validation threw the entire payload away for HEAL over three missing
  optional fields on `earningsHistory`. One absent field must not cost
  the whole response.
- **Quarterly statements come from `incomeStatementHistoryQuarterly`.**
  The library prints a deprecation notice steering to
  `fundamentalsTimeSeries`, but the quarterly module returned 4 periods
  for 4 of 5 tickers when probed. Implementation should re-verify and
  fall back to `fundamentalsTimeSeries` if the module has gone empty.

## Data model

Migration `039`. Three tables and one view.

Key stats, financials and corporate actions move on quarterly and
event-driven clocks; prices move every five minutes. They do not share
storage. Widening `stock_snapshots` would rewrite ~30 static values on
every price tick and bloat the series `ai/indicators.ts` reads.

```sql
stock_key_stats                       -- one upserted row per ticker
  ticker            varchar primary key
  fetched_at        timestamptz not null default now()
  -- valuation
  forward_pe, peg_ratio, price_to_book, enterprise_value, book_value
  trailing_eps, forward_eps
  -- profitability
  profit_margins, ebitda_margins, return_on_equity
  revenue_growth, earnings_growth
  -- health
  current_ratio, quick_ratio, total_cash, total_debt
  free_cashflow, operating_cashflow
  -- street
  target_mean, target_high, target_low
  recommendation_key varchar(24), analyst_count integer
  -- ownership
  shares_outstanding, float_shares
  held_pct_insiders, held_pct_institutions
  change_52w

stock_financials                      -- one row per ticker per period
  primary key (ticker, period_end, period_type)
  period_type       varchar(10)      -- 'QUARTERLY' | 'ANNUAL'; only
                                     -- QUARTERLY is populated initially.
                                     -- ANNUAL exists because period_type is
                                     -- part of the key, not as future scope.
  revenue, cost_of_revenue, gross_profit, operating_income, net_income
  eps
  gross_margin_pct, operating_margin_pct, net_margin_pct
  currency varchar(3), source varchar(24), fetched_at timestamptz

corporate_actions                     -- SPLIT now, IDX types later
  id                bigint generated always as identity primary key
  ticker            varchar not null
  type              varchar(16) not null   -- SPLIT | RIGHTS | BONUS | RUPS
  event_date        date not null
  ex_date           date
  ratio             numeric          -- new shares per old share:
                                     --   1:2 split (1 becomes 2) = 2.0
                                     --   1:10 reverse split        = 0.1
  amount            numeric
  details           jsonb not null default '{}'
  source            varchar(24) not null
  synced_at         timestamptz not null default now()
  unique (ticker, type, event_date)
```

All metric columns are `double precision` and nullable. Margins are
computed on write, not derived at read time, so a later change to
`ai/prompts.ts` can read one column instead of doing arithmetic in the
prompt builder.

### The union view

`dividend_schedule` is not migrated. It works, the Telegram bot's
ex-date and pay-date reminders depend on it, and moving it buys nothing.
Instead the UI reads a view that presents both sources as one timeline:

```sql
create view corporate_actions_all with (security_invoker = true) as
  select ticker,
         'DIVIDEND'                  as type,
         ex_date                     as event_date,
         ex_date,
         null::numeric               as ratio,
         amount_per_share            as amount,
         jsonb_build_object('cum_date', cum_date,
                            'pay_date', pay_date,
                            'estimated', amount_estimated) as details,
         source
    from public.dividend_schedule
  union all
  select ticker, type, event_date, ex_date, ratio, amount, details, source
    from public.corporate_actions;
```

`security_invoker = true` matches every other view in `schema.sql`.

This is the extensibility hinge. When the RUPS/HMETD spike lands a
source, it inserts rows with a new `type` and the UI changes not at all.

## Provider and service

`providers/market.ts` gains two functions. Same file because it already
owns the yahoo client and its quirks.

```ts
fetchKeyStats(ticker: string): Promise<KeyStats | null>
fetchFinancials(ticker: string, periodType?): Promise<FinancialPeriod[]>
fetchSplits(ticker: string, since?: Date): Promise<SplitEvent[]>
```

`fetchSplits` reads `chart(ticker, { events: 'split' })`. This is the
one path in the design that was not probed - verify it returns IDX split
events before building on it. If it does not, splits drop to the same
"needs an IDX source" bucket as RUPS and the Actions tab ships with
dividends only.

New `services/fundamentals.ts`:

```ts
refreshFundamentals(tickers?: string[]): Promise<RefreshResult[]>
```

Fans out over held + watchlist tickers through the existing `mapPool`
concurrency cap in `services/portfolio.ts`. Upserts all three tables.
Per-ticker failures are logged and skipped, never fatal - the same
contract `runPriceRefresh` already honours. Returns per-ticker outcomes
so the caller can log a summary.

## Scheduling

Daily at 18:00 WIB, following the `ASSET_CHECK_HOUR_WIB` pattern already
in `graph/runner.ts:181`: a `>=` hour guard plus a once-per-WIB-day
latch, so a cycle landing at 18:40 still runs it. 18:00 rather than
17:00 keeps it clear of the fund NAV sweep.

Manual triggers: `npm run fundamentals` and, optionally, a
`/fundamentals` bot command.

New env vars: none required. `FUNDAMENTALS_HOUR_WIB` (default 18) if a
knob turns out to be wanted.

## UI

### Structure

`TickerDetail.tsx` is 242 lines and would roughly double. It becomes a
layout file; the sections move into `KeyStats.tsx`, `FinancialsTable.tsx`
and `CorporateActions.tsx`, matching the existing `AnalysisNewsPanels`
split.

A persistent header sits above a tab strip. Tabbing everything would
hide the price while reading financials, so ticker, price, day change,
position summary, freshness line and sparkline stay pinned:

```
BBCA  IDR 6,700  ▲ 1.2%          synced 4 min ago · yahoo-finance2
1,200 shares @ 6,240   +IDR 552,000  ▲ 7.4%        ▁▂▃▅▄▆▇
──────────────────────────────────────────────────────────
 Overview │ Financials │ Actions │ History
 ━━━━━━━━
```

| Tab | Contents |
|---|---|
| Overview | Key Stats, five groups (valuation, profitability, health, street, ownership) |
| Financials | Quarterly table plus revenue / net-income sparkline |
| Actions | Corporate-actions timeline from `corporate_actions_all`, upcoming first |
| History | Transactions plus Recommendation Accuracy |

One tab answers one question, per `knowledge/design.md` → Layout. Page
length is now capped regardless of how many sections arrive later.

### Tabs are URL state

`?tab=financials`, read from `searchParams`. The page stays an async
Server Component querying Postgres directly. Tabs deep-link, survive the
back button, and each render queries only the active tab's tables rather
than all four sections' worth. A client-side tab component would force
`'use client'` across the tree and lose every one of those.

### Styling

Governed by `knowledge/design.md`, which supersedes generic frontend
guidance. Relevant constraints:

- Hairline `border-b` under the strip; active tab marked by a 2px Folio
  Teal underline. Teal is the product's voice and "you are here" is
  exactly that. No pills, no filled tab backgrounds, no cards.
- Inactive labels `on-surface-variant`, active `on-surface`.
- Every figure in JetBrains Mono with `tnum`. Currency written with an
  explicit code (`IDR 6,700`), never a bare symbol.
- Gains teal-green, losses **amber not red**, each paired with ▲ ▼ so
  meaning survives grayscale. Red is reserved for system failure.
- Anything model-derived wears the violet `signal` badge, fencing
  opinion off from measured fact.
- Flat tonal steps and hairline borders only. No shadow, glass, glow or
  gradient. Transitions at most 300ms, collapsing to 0ms under
  `prefers-reduced-motion`.
- Icons line-based, 1.5px stroke, Lucide-compatible.
- No em-dash anywhere in visible copy.

### States

Every tab implements all four:

- **Loading:** skeleton matching the final table's shape, reusing
  `Skeleton.tsx`. Not a spinner.
- **Empty:** names the reason, in logbook register. "No quarterly
  financials published for BSSR" beats "No data".
- **Stale:** each section shows `fetched_at`; older than 7 days is
  marked. Freshness is a component here, not an afterthought.
- **Error:** inline and contextual; never a stack trace.

## Testing

- Provider mapping tested against captured yahoo fixtures, including a
  BSSR-shaped all-nulls payload, so the sparse path is covered by
  default rather than by luck.
- Margin arithmetic tested directly (zero and null revenue included).
- Migration `039` applied against a scratch `postgres:17-alpine` the way
  `037` was: fresh bootstrap, re-run for idempotency, and applied over a
  database that already has `038`.
- View tested for the union shape with a dividend row and a split row
  present.
- Web component tests for empty, partial and populated states, and for
  tab selection driven by `searchParams`.

## Risks and non-goals

**Silent nulls.** ~30 nullable columns fed by an API that reshapes
without notice. If yahoo drops a field the UI shows a gap, not an error.
The 7-day staleness marker is the mitigation; it surfaces a dead feed
even when individual values look merely absent.

**Quarterly module deprecation.** `incomeStatementHistoryQuarterly` is
formally discouraged by the library. It works today. The fallback to
`fundamentalsTimeSeries` should be built when it stops, not before.

**Non-goals.** Full three-statement financials (income statement only,
by decision). RUPS, rights issues and bonus shares (no confirmed source;
a separate spike, and the `type` column is what lets that land later
without a schema change). Feeding `target_mean` or `revenue_growth` into
`ai/prompts.ts` - the columns exist so that becomes possible, but it is
its own change with its own accuracy question.
