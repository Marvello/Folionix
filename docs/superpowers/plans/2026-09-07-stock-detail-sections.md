# Stock Detail Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Key Stats, Financial Reports and Corporate Actions to the stock detail page, behind a tab layout that caps page length.

**Architecture:** Three new Postgres tables plus a union view feed three new server-rendered sections. A daily backend service fetches from yahoo-finance2 and upserts; the web app reads Postgres directly as it already does. Tab state lives in `searchParams` so the page stays an async Server Component and each render queries only the active tab.

**Tech Stack:** Node 24 + TypeScript (ESM, NodeNext), `pg`, `yahoo-finance2` v3, vitest, Next.js 16 App Router, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-07-stock-detail-sections-design.md`

## Global Constraints

- All local TypeScript imports use the `.js` extension (NodeNext ESM).
- Snake_case for DB columns, camelCase for TypeScript variables.
- Section separators in source: `// ── SECTION NAME ──`.
- All code, comments and user-facing strings in English.
- Every migration file ends with its `schema_migrations` insert. Migrations are never applied from app code or tests; the startup runner in `app/src/db/migrate.ts` handles them, and `SCHEMA_BASELINE` is `'036'` so `039` runs normally.
- Every yahoo `quoteSummary` call passes `{ validateResult: false }`. Strict validation discards whole payloads over one missing optional field.
- Every metric column is nullable. Thin small-caps (BSSR) legitimately have no analyst or financial data.
- Web numbers use the `.num` class (JetBrains Mono, tabular). Currency is written with an explicit code: `IDR 6,700`.
- Gains use `text-up`, losses use `text-down` (amber, not red). `text-critical` is reserved for system failure.
- Model-derived values wear the violet `text-ai` / `bg-ai-surface` badge.
- No em-dash (`—`) in any user-visible string.
- `lib/types.ts` and `web/lib/types.ts` are separate files kept in sync by hand. Both must be updated.

---

### Task 1: Migration 039 (schema + union view)

**Files:**
- Create: `db/migrations/039_fundamentals.sql`
- Modify: `db/schema.sql` (append the same DDL, before the ledger insert block)

**Interfaces:**
- Produces: tables `stock_key_stats`, `stock_financials`, `corporate_actions`; view `corporate_actions_all`.

- [ ] **Step 1: Write the migration**

```sql
-- Fundamentals for the stock detail page: key stats, quarterly financials,
-- and corporate actions.
--
-- These move on quarterly and event-driven clocks while prices move every
-- five minutes, so they do not share storage with stock_snapshots. Widening
-- that table would rewrite ~30 static values on every price tick and bloat
-- the series ai/indicators.ts reads.
--
-- Every metric column is nullable: thin IDX small-caps genuinely have no
-- analyst coverage and no published quarterly statements.

create table if not exists public.stock_key_stats (
    ticker                 varchar(20) primary key,
    fetched_at             timestamptz not null default now(),
    forward_pe             double precision,
    peg_ratio              double precision,
    price_to_book          double precision,
    enterprise_value       double precision,
    book_value             double precision,
    trailing_eps           double precision,
    forward_eps            double precision,
    profit_margins         double precision,
    ebitda_margins         double precision,
    return_on_equity       double precision,
    revenue_growth         double precision,
    earnings_growth        double precision,
    current_ratio          double precision,
    quick_ratio            double precision,
    total_cash             double precision,
    total_debt             double precision,
    free_cashflow          double precision,
    operating_cashflow     double precision,
    target_mean            double precision,
    target_high            double precision,
    target_low             double precision,
    recommendation_key     varchar(24),
    analyst_count          integer,
    shares_outstanding     double precision,
    float_shares           double precision,
    held_pct_insiders      double precision,
    held_pct_institutions  double precision,
    change_52w             double precision
);

create table if not exists public.stock_financials (
    ticker                varchar(20) not null,
    period_end            date        not null,
    -- 'QUARTERLY' | 'ANNUAL'. Only QUARTERLY is populated initially; ANNUAL
    -- exists because period_type is part of the key, not as future scope.
    period_type           varchar(10) not null,
    revenue               double precision,
    cost_of_revenue       double precision,
    gross_profit          double precision,
    operating_income      double precision,
    net_income            double precision,
    eps                   double precision,
    gross_margin_pct      double precision,
    operating_margin_pct  double precision,
    net_margin_pct        double precision,
    currency              varchar(3),
    source                varchar(24) not null default 'yahoo',
    fetched_at            timestamptz not null default now(),
    primary key (ticker, period_end, period_type)
);

create table if not exists public.corporate_actions (
    id          bigint generated always as identity primary key,
    ticker      varchar(20) not null,
    -- SPLIT | RIGHTS | BONUS | RUPS. Only SPLIT is populated initially; the
    -- IDX-scraped types land later as inserts, not as a schema change.
    type        varchar(16) not null,
    event_date  date        not null,
    ex_date     date,
    -- New shares per old share: a 1:2 split (1 becomes 2) is 2.0,
    -- a 1:10 reverse split is 0.1.
    ratio       numeric,
    amount      numeric,
    details     jsonb       not null default '{}',
    source      varchar(24) not null,
    synced_at   timestamptz not null default now(),
    unique (ticker, type, event_date)
);

create index if not exists idx_stock_financials_ticker_period
    on public.stock_financials (ticker, period_end desc);
create index if not exists idx_corporate_actions_ticker_date
    on public.corporate_actions (ticker, event_date desc);

-- dividend_schedule is deliberately NOT migrated: it works and the Telegram
-- bot's ex-date and pay-date reminders read it. The view presents both
-- sources as one timeline so the UI has a single read path.
create or replace view public.corporate_actions_all
with (security_invoker = true) as
select ticker,
       'DIVIDEND'::varchar(16) as type,
       ex_date                 as event_date,
       ex_date,
       null::numeric           as ratio,
       amount_per_share        as amount,
       jsonb_build_object('cum_date', cum_date,
                          'pay_date', pay_date,
                          'estimated', amount_estimated) as details,
       source
  from public.dividend_schedule
union all
select ticker, type, event_date, ex_date, ratio, amount, details, source
  from public.corporate_actions;

insert into public.schema_migrations (version, name)
values ('039', '039_fundamentals') on conflict do nothing;
```

- [ ] **Step 2: Verify it applies to a fresh database**

```bash
cd /Users/marvellooni/Project/folionix
docker run --rm -d --name fx-039 -e POSTGRES_PASSWORD=x -e POSTGRES_DB=folionix \
  -p 55436:5432 postgres:17-alpine
U="postgresql://postgres:x@localhost:55436/folionix"
for i in $(seq 1 40); do psql "$U" -Atc 'select 1' >/dev/null 2>&1 && break; done
psql "$U" -q -v ON_ERROR_STOP=1 -f db/schema.sql; echo "schema exit=$?"
psql "$U" -1 -q -v ON_ERROR_STOP=1 -f db/migrations/037_accuracy_benchmark_relative.sql; echo "037 exit=$?"
psql "$U" -1 -q -v ON_ERROR_STOP=1 -f db/migrations/038_restore_latest_analyses_invoker.sql; echo "038 exit=$?"
psql "$U" -1 -q -v ON_ERROR_STOP=1 -f db/migrations/039_fundamentals.sql; echo "039 exit=$?"
psql "$U" -1 -q -v ON_ERROR_STOP=1 -f db/migrations/039_fundamentals.sql; echo "039 rerun exit=$?"
```

Expected: every `exit=0`. Do not pipe to `tail` or `grep`; that hides the exit code.

- [ ] **Step 3: Verify the union view returns both sources**

```bash
U="postgresql://postgres:x@localhost:55436/folionix"
psql "$U" -q <<'SQL'
insert into dividend_schedule (ticker, cum_date, ex_date, recording_date, pay_date,
                               amount_per_share, amount_estimated, currency, source, synced_at)
values ('BBCA.JK','2026-04-10','2026-04-11','2026-04-12','2026-04-25',270,false,'IDR','idx',now());
insert into corporate_actions (ticker, type, event_date, ex_date, ratio, source)
values ('BBCA.JK','SPLIT','2026-03-01','2026-03-01',2.0,'yahoo');
SQL
psql "$U" -Atc "select type, event_date, amount, ratio from corporate_actions_all order by event_date;"
```

Expected exactly two rows:
```
SPLIT|2026-03-01||2.0
DIVIDEND|2026-04-11|270|
```

- [ ] **Step 4: Append the same DDL to db/schema.sql**

Insert the three `create table` statements, both `create index` statements and the `create or replace view` into `db/schema.sql` immediately before the `-- ── migration ledger ──` comment block. Then add `('039', '039_fundamentals'),` to the ledger insert list, keeping numeric order, and bump `SCHEMA_BASELINE` in `app/src/db/migrate.ts` from `'036'` to `'039'`.

Do NOT copy the migration's trailing `insert into public.schema_migrations` line into `schema.sql`; the consolidated ledger block already covers it.

- [ ] **Step 5: Verify the baseline bump did not break the runner**

```bash
cd app && npm test -- src/db/migrate.test.ts
```

Expected: the assertion `expect(SCHEMA_BASELINE).toBe('036')` FAILS. Update that test to `'039'`, then re-run. Expected: PASS. This test exists precisely to make the baseline bump a deliberate act.

- [ ] **Step 6: Tear down and commit**

```bash
docker rm -f fx-039
git add db/migrations/039_fundamentals.sql db/schema.sql app/src/db/migrate.ts app/src/db/migrate.test.ts
git commit -m "feat(db): add key stats, financials and corporate actions tables"
```

---

### Task 2: Shared row types

**Files:**
- Modify: `lib/types.ts` (append)
- Modify: `web/lib/types.ts` (append the same, verbatim)

**Interfaces:**
- Produces: `StockKeyStatsRow`, `StockFinancialRow`, `CorporateActionRow`. Every task after this imports them.

- [ ] **Step 1: Append to lib/types.ts**

```ts
// One row of stock_key_stats (slow-moving fundamentals, one per ticker)
export interface StockKeyStatsRow {
  ticker: string
  fetched_at: string
  forward_pe: number | null
  peg_ratio: number | null
  price_to_book: number | null
  enterprise_value: number | null
  book_value: number | null
  trailing_eps: number | null
  forward_eps: number | null
  profit_margins: number | null
  ebitda_margins: number | null
  return_on_equity: number | null
  revenue_growth: number | null
  earnings_growth: number | null
  current_ratio: number | null
  quick_ratio: number | null
  total_cash: number | null
  total_debt: number | null
  free_cashflow: number | null
  operating_cashflow: number | null
  target_mean: number | null
  target_high: number | null
  target_low: number | null
  recommendation_key: string | null
  analyst_count: number | null
  shares_outstanding: number | null
  float_shares: number | null
  held_pct_insiders: number | null
  held_pct_institutions: number | null
  change_52w: number | null
}

// One row of stock_financials (one reporting period per ticker)
export interface StockFinancialRow {
  ticker: string
  period_end: string
  period_type: 'QUARTERLY' | 'ANNUAL'
  revenue: number | null
  cost_of_revenue: number | null
  gross_profit: number | null
  operating_income: number | null
  net_income: number | null
  eps: number | null
  gross_margin_pct: number | null
  operating_margin_pct: number | null
  net_margin_pct: number | null
  currency: string | null
  source: string
  fetched_at: string
}

// One row of the corporate_actions_all view (corporate_actions + dividend_schedule)
export interface CorporateActionRow {
  ticker: string
  type: 'DIVIDEND' | 'SPLIT' | 'RIGHTS' | 'BONUS' | 'RUPS'
  event_date: string
  ex_date: string | null
  ratio: number | null
  amount: number | null
  details: Record<string, unknown>
  source: string
}
```

- [ ] **Step 2: Copy the same block verbatim into web/lib/types.ts**

`web/` is isolated from repo-root `lib/`; the two files are kept in sync by hand. Paste the identical block.

- [ ] **Step 3: Verify both typecheck**

```bash
cd app && npm run typecheck
cd ../web && npx tsc --noEmit
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts web/lib/types.ts
git commit -m "feat(types): add key stats, financial and corporate action row types"
```

---

### Task 3: Provider - fetchKeyStats

**Files:**
- Modify: `app/src/providers/market.ts` (append a new `// ── FUNDAMENTALS ──` section)
- Test: `app/src/providers/market.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface KeyStats` (same field names as `StockKeyStatsRow` minus `ticker`/`fetched_at`), and `export async function fetchKeyStats(ticker: string): Promise<KeyStats | null>`.

- [ ] **Step 1: Write the failing test**

Append to `app/src/providers/market.test.ts`:

```ts
describe('mapKeyStats', () => {
  it('maps a populated payload across both yahoo modules', async () => {
    const { mapKeyStats } = await import('./market.js')
    const out = mapKeyStats({
      defaultKeyStatistics: {
        forwardPE: 19.8, pegRatio: 1.8, priceToBook: 4.1, enterpriseValue: 8.2e14,
        bookValue: 1630, trailingEps: 312, forwardEps: 340, profitMargins: 0.527,
        sharesOutstanding: 1.23e11, floatShares: 5.5e10,
        heldPercentInsiders: 0.549, heldPercentInstitutions: 0.121, '52WeekChange': 0.184,
      },
      financialData: {
        targetMeanPrice: 8194.84, targetHighPrice: 9000, targetLowPrice: 7000,
        recommendationKey: 'strong_buy', numberOfAnalystOpinions: 25,
        currentRatio: 1.24, quickRatio: 1.1, returnOnEquity: 0.182,
        revenueGrowth: 0.081, earningsGrowth: 0.064, ebitdaMargins: 0.61,
        totalCash: 3.1e14, totalDebt: 9.6e13,
        freeCashflow: 1.24e13, operatingCashflow: 1.9e13,
      },
    })
    expect(out.forward_pe).toBe(19.8)
    expect(out.recommendation_key).toBe('strong_buy')
    expect(out.analyst_count).toBe(25)
    expect(out.held_pct_insiders).toBe(0.549)
    expect(out.change_52w).toBe(0.184)
  })

  it('returns nulls rather than undefined for a sparse small-cap payload', async () => {
    const { mapKeyStats } = await import('./market.js')
    // BSSR shape: key statistics present, no analyst coverage at all.
    const out = mapKeyStats({
      defaultKeyStatistics: { priceToBook: 2.7, bookValue: 1800 },
      financialData: {},
    })
    expect(out.price_to_book).toBe(2.7)
    expect(out.target_mean).toBeNull()
    expect(out.analyst_count).toBeNull()
    expect(out.forward_pe).toBeNull()
    expect(Object.values(out).every((v) => v !== undefined)).toBe(true)
  })

  it('treats an entirely absent module as all nulls', async () => {
    const { mapKeyStats } = await import('./market.js')
    const out = mapKeyStats({})
    expect(out.target_mean).toBeNull()
    expect(out.price_to_book).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/providers/market.test.ts -t mapKeyStats`
Expected: FAIL, `mapKeyStats is not a function`.

- [ ] **Step 3: Implement**

Append to `app/src/providers/market.ts`:

```ts
// ── FUNDAMENTALS ──

export interface KeyStats {
  forward_pe: number | null
  peg_ratio: number | null
  price_to_book: number | null
  enterprise_value: number | null
  book_value: number | null
  trailing_eps: number | null
  forward_eps: number | null
  profit_margins: number | null
  ebitda_margins: number | null
  return_on_equity: number | null
  revenue_growth: number | null
  earnings_growth: number | null
  current_ratio: number | null
  quick_ratio: number | null
  total_cash: number | null
  total_debt: number | null
  free_cashflow: number | null
  operating_cashflow: number | null
  target_mean: number | null
  target_high: number | null
  target_low: number | null
  recommendation_key: string | null
  analyst_count: number | null
  shares_outstanding: number | null
  float_shares: number | null
  held_pct_insiders: number | null
  held_pct_institutions: number | null
  change_52w: number | null
}

/** Yahoo returns undefined for absent fields; the DB wants null. */
function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

type RawSummary = {
  defaultKeyStatistics?: Record<string, unknown>
  financialData?: Record<string, unknown>
}

/** Pure mapping from a quoteSummary payload to KeyStats. Exported for tests. */
export function mapKeyStats(raw: RawSummary): KeyStats {
  const k = raw.defaultKeyStatistics ?? {}
  const f = raw.financialData ?? {}
  return {
    forward_pe: n(k.forwardPE),
    peg_ratio: n(k.pegRatio),
    price_to_book: n(k.priceToBook),
    enterprise_value: n(k.enterpriseValue),
    book_value: n(k.bookValue),
    trailing_eps: n(k.trailingEps),
    forward_eps: n(k.forwardEps),
    profit_margins: n(k.profitMargins),
    ebitda_margins: n(f.ebitdaMargins),
    return_on_equity: n(f.returnOnEquity),
    revenue_growth: n(f.revenueGrowth),
    earnings_growth: n(f.earningsGrowth),
    current_ratio: n(f.currentRatio),
    quick_ratio: n(f.quickRatio),
    total_cash: n(f.totalCash),
    total_debt: n(f.totalDebt),
    free_cashflow: n(f.freeCashflow),
    operating_cashflow: n(f.operatingCashflow),
    target_mean: n(f.targetMeanPrice),
    target_high: n(f.targetHighPrice),
    target_low: n(f.targetLowPrice),
    recommendation_key: s(f.recommendationKey),
    analyst_count: n(f.numberOfAnalystOpinions),
    shares_outstanding: n(k.sharesOutstanding),
    float_shares: n(k.floatShares),
    held_pct_insiders: n(k.heldPercentInsiders),
    held_pct_institutions: n(k.heldPercentInstitutions),
    change_52w: n(k['52WeekChange']),
  }
}

/**
 * Key statistics for one ticker. Returns null when the whole call fails; a
 * ticker with no analyst coverage still returns an object full of nulls,
 * which is a real answer and not an error.
 *
 * validateResult is off deliberately: strict schema validation discarded the
 * entire payload for HEAL.JK over three missing optional fields.
 */
export async function fetchKeyStats(ticker: string): Promise<KeyStats | null> {
  const symbol = normalizeTicker(ticker)
  try {
    const raw = await withRetry(`keyStats ${symbol}`, () =>
      yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics', 'financialData'] },
                      { validateResult: false }))
    return mapKeyStats(raw as RawSummary)
  } catch (err) {
    console.error(`[market] keyStats ${symbol}:`, err instanceof Error ? err.message : err)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/providers/market.test.ts -t mapKeyStats`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/providers/market.ts app/src/providers/market.test.ts
git commit -m "feat(market): fetch key statistics from yahoo quoteSummary"
```

---

### Task 4: Provider - fetchFinancials

**Files:**
- Modify: `app/src/providers/market.ts` (extend the `// ── FUNDAMENTALS ──` section)
- Test: `app/src/providers/market.test.ts` (append)

**Interfaces:**
- Consumes: `n()`, `s()`, `yf`, `withRetry` from Task 3.
- Produces: `export interface FinancialPeriod` and `export async function fetchFinancials(ticker: string): Promise<FinancialPeriod[]>`, plus `export function mapFinancialPeriod(row, currency)`.

- [ ] **Step 1: Write the failing test**

```ts
describe('mapFinancialPeriod', () => {
  it('computes margins from revenue', async () => {
    const { mapFinancialPeriod } = await import('./market.js')
    const out = mapFinancialPeriod({
      endDate: new Date('2026-06-30T00:00:00Z'),
      totalRevenue: 28157061000000,
      costOfRevenue: 9412330000000,
      grossProfit: 18744731000000,
      operatingIncome: 14641847000000,
      netIncome: 14850323000000,
    }, 'IDR')
    expect(out.period_end).toBe('2026-06-30')
    expect(out.period_type).toBe('QUARTERLY')
    expect(out.net_margin_pct).toBeCloseTo(52.74, 1)
    expect(out.gross_margin_pct).toBeCloseTo(66.57, 1)
    expect(out.currency).toBe('IDR')
  })

  it('returns null margins when revenue is zero, never Infinity or NaN', async () => {
    const { mapFinancialPeriod } = await import('./market.js')
    const out = mapFinancialPeriod(
      { endDate: new Date('2026-06-30T00:00:00Z'), totalRevenue: 0, netIncome: -5e9 }, 'IDR')
    expect(out.net_margin_pct).toBeNull()
    expect(out.gross_margin_pct).toBeNull()
    expect(out.net_income).toBe(-5e9)
  })

  it('returns null margins when revenue is absent', async () => {
    const { mapFinancialPeriod } = await import('./market.js')
    const out = mapFinancialPeriod({ endDate: new Date('2026-03-31T00:00:00Z') }, null)
    expect(out.revenue).toBeNull()
    expect(out.net_margin_pct).toBeNull()
    expect(out.currency).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/providers/market.test.ts -t mapFinancialPeriod`
Expected: FAIL, `mapFinancialPeriod is not a function`.

- [ ] **Step 3: Implement**

```ts
export interface FinancialPeriod {
  period_end: string
  period_type: 'QUARTERLY' | 'ANNUAL'
  revenue: number | null
  cost_of_revenue: number | null
  gross_profit: number | null
  operating_income: number | null
  net_income: number | null
  eps: number | null
  gross_margin_pct: number | null
  operating_margin_pct: number | null
  net_margin_pct: number | null
  currency: string | null
}

/** Margin as a percentage, or null when the denominator is missing or zero. */
function marginPct(part: number | null, revenue: number | null): number | null {
  if (part == null || revenue == null || revenue === 0) return null
  const pct = (part / revenue) * 100
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null
}

/** Slice a Date or ISO string to YYYY-MM-DD. */
function toDay(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && v.length >= 10) return v.slice(0, 10)
  return null
}

/**
 * Pure mapping of one yahoo income-statement row. Margins are computed here,
 * on write, so consumers (and a future prompt change) read one column instead
 * of redoing the arithmetic.
 */
export function mapFinancialPeriod(
  row: Record<string, unknown>, currency: string | null,
): FinancialPeriod {
  const revenue = n(row.totalRevenue)
  return {
    period_end: toDay(row.endDate) ?? '1970-01-01',
    period_type: 'QUARTERLY',
    revenue,
    cost_of_revenue: n(row.costOfRevenue),
    gross_profit: n(row.grossProfit),
    operating_income: n(row.operatingIncome),
    net_income: n(row.netIncome),
    eps: n(row.dilutedEPS) ?? n(row.basicEPS),
    gross_margin_pct: marginPct(n(row.grossProfit), revenue),
    operating_margin_pct: marginPct(n(row.operatingIncome), revenue),
    net_margin_pct: marginPct(n(row.netIncome), revenue),
    currency,
  }
}

/**
 * Recent quarterly income statements, newest first. [] when the issuer has
 * none published, which is the normal state for thin IDX small-caps.
 *
 * yahoo-finance2 prints a deprecation notice for this module and steers to
 * fundamentalsTimeSeries. It still returned 4 periods for 4 of 5 probed IDX
 * tickers. If it goes empty across the board, switch to fundamentalsTimeSeries
 * here; nothing above this function needs to change.
 */
export async function fetchFinancials(ticker: string): Promise<FinancialPeriod[]> {
  const symbol = normalizeTicker(ticker)
  try {
    const raw = await withRetry(`financials ${symbol}`, () =>
      yf.quoteSummary(symbol,
        { modules: ['incomeStatementHistoryQuarterly', 'summaryDetail'] },
        { validateResult: false })) as {
          incomeStatementHistoryQuarterly?: { incomeStatementHistory?: Record<string, unknown>[] }
          summaryDetail?: { currency?: string }
        }
    const rows = raw.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []
    const currency = s(raw.summaryDetail?.currency)?.toUpperCase() ?? null
    return rows
      .map((r) => mapFinancialPeriod(r, currency))
      .filter((p) => p.period_end !== '1970-01-01')
      .sort((a, b) => b.period_end.localeCompare(a.period_end))
  } catch (err) {
    console.error(`[market] financials ${symbol}:`, err instanceof Error ? err.message : err)
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/providers/market.test.ts -t mapFinancialPeriod`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/providers/market.ts app/src/providers/market.test.ts
git commit -m "feat(market): fetch quarterly income statements with computed margins"
```

---

### Task 5: Provider - fetchSplits (verify first, then build)

**Files:**
- Modify: `app/src/providers/market.ts`
- Test: `app/src/providers/market.test.ts` (append)

**Interfaces:**
- Produces: `export interface SplitEvent { event_date: string; ratio: number | null }` and `export async function fetchSplits(ticker: string, since?: Date): Promise<SplitEvent[]>`.

- [ ] **Step 1: Verify yahoo actually returns IDX split events**

This is the one path in the spec that was never probed. Find out before building on it.

```bash
cd /Users/marvellooni/Project/folionix
cat > probe-splits.mjs <<'JS'
import yf from 'yahoo-finance2';
const YF = yf.default ?? yf;
const y = new YF({ suppressNotices: ['yahooSurvey'] });
// SMGR and BBRI both had IDX splits in the last decade.
for (const t of ['BBRI.JK', 'SMGR.JK', 'BBCA.JK']) {
  try {
    const r = await y.chart(t, { period1: '2015-01-01', interval: '1d', events: 'split' },
                           { validateResult: false });
    console.log(t, 'splits:', JSON.stringify(r.events?.splits ?? r.events ?? null)?.slice(0, 300));
  } catch (e) { console.log(t, 'ERR', e.message.slice(0, 80)); }
}
JS
node probe-splits.mjs; rm -f probe-splits.mjs
```

**If splits come back:** continue to Step 2.
**If all three return null/empty:** STOP. Do not build `fetchSplits`. Record the finding in the spec's Risks section, skip to Task 6, and have Task 10 render the Actions tab from dividends only. The `type` column already accommodates splits arriving later. Report this to the user rather than deciding silently.

- [ ] **Step 2: Write the failing test**

```ts
describe('mapSplits', () => {
  it('maps yahoo split events to ratio as new-shares-per-old-share', async () => {
    const { mapSplits } = await import('./market.js')
    // yahoo reports a 1-becomes-2 split as numerator 2, denominator 1.
    const out = mapSplits({
      '1451606400': { date: 1451606400, numerator: 2, denominator: 1, splitRatio: '2:1' },
    })
    expect(out).toHaveLength(1)
    expect(out[0].ratio).toBe(2)
    expect(out[0].event_date).toBe('2016-01-01')
  })

  it('maps a reverse split to a ratio below 1', async () => {
    const { mapSplits } = await import('./market.js')
    const out = mapSplits({
      '1451606400': { date: 1451606400, numerator: 1, denominator: 10, splitRatio: '1:10' },
    })
    expect(out[0].ratio).toBe(0.1)
  })

  it('returns [] for no events', async () => {
    const { mapSplits } = await import('./market.js')
    expect(mapSplits(undefined)).toEqual([])
    expect(mapSplits({})).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/providers/market.test.ts -t mapSplits`
Expected: FAIL, `mapSplits is not a function`.

- [ ] **Step 4: Implement**

```ts
export interface SplitEvent {
  event_date: string
  ratio: number | null
}

type RawSplit = { date?: number; numerator?: number; denominator?: number }

/**
 * Pure mapping of yahoo's split events. Ratio is stored as new shares per old
 * share: a 1-becomes-2 split is 2.0, a 1:10 reverse split is 0.1. Getting this
 * inverted would silently corrupt any future cost-basis adjustment.
 */
export function mapSplits(events: Record<string, RawSplit> | undefined): SplitEvent[] {
  if (!events) return []
  return Object.values(events)
    .map((e) => {
      const num = n(e.numerator)
      const den = n(e.denominator)
      const day = typeof e.date === 'number'
        ? new Date(e.date * 1000).toISOString().slice(0, 10)
        : null
      if (!day) return null
      return { event_date: day, ratio: num != null && den ? num / den : null }
    })
    .filter((x): x is SplitEvent => x !== null)
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
}

/** Split events for a ticker since `since` (default: 5 years back). */
export async function fetchSplits(ticker: string, since?: Date): Promise<SplitEvent[]> {
  const symbol = normalizeTicker(ticker)
  const from = since ?? new Date(Date.now() - 5 * 365 * 24 * 3_600_000)
  try {
    const r = await withRetry(`splits ${symbol}`, () =>
      yf.chart(symbol, { period1: from, interval: '1d', events: 'split' },
               { validateResult: false })) as { events?: { splits?: Record<string, RawSplit> } }
    return mapSplits(r.events?.splits)
  } catch (err) {
    console.error(`[market] splits ${symbol}:`, err instanceof Error ? err.message : err)
    return []
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/providers/market.test.ts -t mapSplits`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/providers/market.ts app/src/providers/market.test.ts
git commit -m "feat(market): fetch stock split events"
```

---

### Task 6: DB layer

**Files:**
- Modify: `app/src/db/db.ts` (append a `// ── FUNDAMENTALS ──` section)

**Interfaces:**
- Consumes: `KeyStats`, `FinancialPeriod`, `SplitEvent` from Tasks 3-5.
- Produces:
  - `saveKeyStats(ticker: string, stats: KeyStats): Promise<void>`
  - `saveFinancials(ticker: string, periods: FinancialPeriod[]): Promise<void>`
  - `saveCorporateActions(ticker: string, type: string, events: Array<{ event_date: string; ratio?: number | null; amount?: number | null; details?: Record<string, unknown> }>, source: string): Promise<void>`
  - `getKeyStats(ticker: string): Promise<StockKeyStatsRow | null>`
  - `getFinancials(ticker: string, limit?: number): Promise<StockFinancialRow[]>`
  - `getCorporateActions(ticker: string): Promise<CorporateActionRow[]>`

- [ ] **Step 1: Implement (no unit test; this layer is exercised by Task 7's integration check)**

Append to `app/src/db/db.ts`:

```ts
// ── FUNDAMENTALS ──

const KEY_STAT_COLS = [
  'forward_pe', 'peg_ratio', 'price_to_book', 'enterprise_value', 'book_value',
  'trailing_eps', 'forward_eps', 'profit_margins', 'ebitda_margins',
  'return_on_equity', 'revenue_growth', 'earnings_growth', 'current_ratio',
  'quick_ratio', 'total_cash', 'total_debt', 'free_cashflow',
  'operating_cashflow', 'target_mean', 'target_high', 'target_low',
  'recommendation_key', 'analyst_count', 'shares_outstanding', 'float_shares',
  'held_pct_insiders', 'held_pct_institutions', 'change_52w',
] as const

export async function saveKeyStats(ticker: string, stats: KeyStats): Promise<void> {
  const cols = ['ticker', ...KEY_STAT_COLS, 'fetched_at']
  const values = [ticker, ...KEY_STAT_COLS.map((c) => stats[c as keyof KeyStats])]
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
  const updates = KEY_STAT_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')
  await q(
    `INSERT INTO stock_key_stats (${cols.join(', ')})
     VALUES (${placeholders}, now())
     ON CONFLICT (ticker) DO UPDATE SET ${updates}, fetched_at = now()`,
    values,
  )
}

export async function saveFinancials(ticker: string, periods: FinancialPeriod[]): Promise<void> {
  for (const p of periods) {
    await q(
      `INSERT INTO stock_financials
         (ticker, period_end, period_type, revenue, cost_of_revenue, gross_profit,
          operating_income, net_income, eps, gross_margin_pct, operating_margin_pct,
          net_margin_pct, currency, source, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'yahoo',now())
       ON CONFLICT (ticker, period_end, period_type) DO UPDATE SET
         revenue = $4, cost_of_revenue = $5, gross_profit = $6,
         operating_income = $7, net_income = $8, eps = $9,
         gross_margin_pct = $10, operating_margin_pct = $11,
         net_margin_pct = $12, currency = $13, fetched_at = now()`,
      [ticker, p.period_end, p.period_type, p.revenue, p.cost_of_revenue,
       p.gross_profit, p.operating_income, p.net_income, p.eps,
       p.gross_margin_pct, p.operating_margin_pct, p.net_margin_pct, p.currency],
    )
  }
}

export async function saveCorporateActions(
  ticker: string,
  type: string,
  events: Array<{ event_date: string; ratio?: number | null; amount?: number | null; details?: Record<string, unknown> }>,
  source: string,
): Promise<void> {
  for (const e of events) {
    await q(
      `INSERT INTO corporate_actions (ticker, type, event_date, ex_date, ratio, amount, details, source, synced_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,now())
       ON CONFLICT (ticker, type, event_date) DO UPDATE SET
         ratio = $4, amount = $5, details = $6, synced_at = now()`,
      [ticker, type, e.event_date, e.ratio ?? null, e.amount ?? null,
       JSON.stringify(e.details ?? {}), source],
    )
  }
}

export async function getKeyStats(ticker: string): Promise<StockKeyStatsRow | null> {
  const { rows } = await q('SELECT * FROM stock_key_stats WHERE ticker = $1', [ticker])
  return rows[0] ?? null
}

export async function getFinancials(ticker: string, limit = 8): Promise<StockFinancialRow[]> {
  const { rows } = await q(
    `SELECT * FROM stock_financials WHERE ticker = $1 AND period_type = 'QUARTERLY'
     ORDER BY period_end DESC LIMIT $2`,
    [ticker, limit],
  )
  return rows
}

export async function getCorporateActions(ticker: string): Promise<CorporateActionRow[]> {
  const { rows } = await q(
    'SELECT * FROM corporate_actions_all WHERE ticker = $1 ORDER BY event_date DESC',
    [ticker],
  )
  return rows
}
```

Add `KeyStats`, `FinancialPeriod` to the import from `../providers/market.js`, and `StockKeyStatsRow`, `StockFinancialRow`, `CorporateActionRow` to the existing `lib/types.js` type import at the top of the file.

- [ ] **Step 2: Verify it typechecks**

Run: `cd app && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/db/db.ts
git commit -m "feat(db): read and write fundamentals tables"
```

---

### Task 7: Service - refreshFundamentals

**Files:**
- Create: `app/src/services/fundamentals.ts`
- Create: `app/src/services/fundamentals.test.ts`
- Modify: `app/package.json` (add script)
- Modify: `app/build.mjs` (add entry point)

**Interfaces:**
- Consumes: `fetchKeyStats`, `fetchFinancials`, `fetchSplits` (Tasks 3-5); `saveKeyStats`, `saveFinancials`, `saveCorporateActions` (Task 6).
- Produces: `export interface RefreshResult { ticker: string; keyStats: boolean; periods: number; splits: number; error?: string }` and `export async function refreshFundamentals(tickers?: string[]): Promise<RefreshResult[]>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('refreshFundamentals', () => {
  beforeEach(() => { vi.resetModules() })

  it('records one result per ticker and keeps going after a failure', async () => {
    vi.doMock('../db/db.js', () => ({
      loadPortfolio: async () => ({ 'BBCA.JK': { avg_price: 6240, lots: 12, notes: null } }),
      getWatchlist: async () => [{ ticker: 'BSSR.JK' }],
      saveKeyStats: vi.fn(async () => {}),
      saveFinancials: vi.fn(async () => {}),
      saveCorporateActions: vi.fn(async () => {}),
    }))
    vi.doMock('../providers/market.js', () => ({
      fetchKeyStats: async (t: string) => {
        if (t === 'BSSR.JK') throw new Error('yahoo 404')
        return { price_to_book: 4.1 }
      },
      fetchFinancials: async () => [{ period_end: '2026-06-30' }],
      fetchSplits: async () => [],
    }))

    const { refreshFundamentals } = await import('./fundamentals.js')
    const results = await refreshFundamentals()

    expect(results).toHaveLength(2)
    const bbca = results.find((r) => r.ticker === 'BBCA.JK')!
    expect(bbca.keyStats).toBe(true)
    expect(bbca.periods).toBe(1)
    const bssr = results.find((r) => r.ticker === 'BSSR.JK')!
    expect(bssr.error).toContain('yahoo 404')
    expect(bssr.keyStats).toBe(false)
  })

  it('honours an explicit ticker list', async () => {
    vi.doMock('../db/db.js', () => ({
      loadPortfolio: async () => ({ 'BBCA.JK': {}, 'TLKM.JK': {} }),
      getWatchlist: async () => [],
      saveKeyStats: vi.fn(async () => {}),
      saveFinancials: vi.fn(async () => {}),
      saveCorporateActions: vi.fn(async () => {}),
    }))
    vi.doMock('../providers/market.js', () => ({
      fetchKeyStats: async () => ({ price_to_book: 1 }),
      fetchFinancials: async () => [],
      fetchSplits: async () => [],
    }))
    const { refreshFundamentals } = await import('./fundamentals.js')
    const results = await refreshFundamentals(['TLKM'])
    expect(results.map((r) => r.ticker)).toEqual(['TLKM.JK'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/services/fundamentals.test.ts`
Expected: FAIL, cannot find module `./fundamentals.js`.

- [ ] **Step 3: Implement**

```ts
import 'dotenv/config'
import {
  loadPortfolio, getWatchlist,
  saveKeyStats, saveFinancials, saveCorporateActions,
} from '../db/db.js'
import { fetchKeyStats, fetchFinancials, fetchSplits } from '../providers/market.js'
import { normalizeTicker } from '../../../lib/format.js'

// ── FUNDAMENTALS REFRESH ──

const CONCURRENCY = Math.max(1, Number(process.env.PROVIDER_CONCURRENCY) || 4)

export interface RefreshResult {
  ticker: string
  keyStats: boolean
  periods: number
  splits: number
  error?: string
}

async function refreshOne(ticker: string): Promise<RefreshResult> {
  const result: RefreshResult = { ticker, keyStats: false, periods: 0, splits: 0 }
  try {
    const [stats, periods, splits] = await Promise.all([
      fetchKeyStats(ticker), fetchFinancials(ticker), fetchSplits(ticker),
    ])
    if (stats) { await saveKeyStats(ticker, stats); result.keyStats = true }
    if (periods.length > 0) { await saveFinancials(ticker, periods); result.periods = periods.length }
    if (splits.length > 0) {
      await saveCorporateActions(ticker, 'SPLIT',
        splits.map((s) => ({ event_date: s.event_date, ratio: s.ratio })), 'yahoo')
      result.splits = splits.length
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  return result
}

/**
 * Refresh fundamentals for held + watchlist tickers (or an explicit list).
 * Per-ticker failures are recorded and skipped, never fatal, the same
 * contract runPriceRefresh honours.
 */
export async function refreshFundamentals(tickers?: string[]): Promise<RefreshResult[]> {
  const [portfolio, watch] = await Promise.all([loadPortfolio(), getWatchlist()])
  const all = Array.from(new Set([
    ...Object.keys(portfolio),
    ...watch.map((w: { ticker: string }) => w.ticker),
  ].map(normalizeTicker)))
  const wanted = tickers && tickers.length > 0
    ? all.filter((t) => tickers.map(normalizeTicker).includes(t))
    : all

  const results: RefreshResult[] = new Array(wanted.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, async () => {
    while (cursor < wanted.length) {
      const i = cursor++
      results[i] = await refreshOne(wanted[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

if (process.argv[1]?.endsWith('fundamentals.ts') || process.argv[1]?.endsWith('fundamentals.js')) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  refreshFundamentals(args.length > 0 ? args : undefined)
    .then((rs) => {
      for (const r of rs) {
        console.log(`[fundamentals] ${r.ticker}: stats=${r.keyStats} periods=${r.periods} splits=${r.splits}${r.error ? ` error=${r.error}` : ''}`)
      }
      const ok = rs.filter((r) => !r.error).length
      console.log(`[fundamentals] ${ok}/${rs.length} refreshed`)
    })
    .catch((err: unknown) => {
      console.error('[fundamentals]', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/services/fundamentals.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the npm script and build entry**

In `app/package.json` scripts, add: `"fundamentals": "tsx src/services/fundamentals.ts"`
In `app/build.mjs` `entryPoints`, add: `'src/services/fundamentals.ts',`

- [ ] **Step 6: Verify the build emits it**

Run: `cd app && node build.mjs && ls dist/services/fundamentals.js`
Expected: the file exists.

- [ ] **Step 7: Commit**

```bash
git add app/src/services/fundamentals.ts app/src/services/fundamentals.test.ts app/package.json app/build.mjs
git commit -m "feat(fundamentals): daily refresh service for key stats, financials and splits"
```

---

### Task 8: Schedule the daily refresh

**Files:**
- Modify: `app/src/graph/runner.ts` (constants near line 21, loop body near line 181)

**Interfaces:**
- Consumes: `refreshFundamentals` from Task 7.

- [ ] **Step 1: Add the constant and import**

Near `const ASSET_CHECK_HOUR_WIB = 17` add:

```ts
// Fundamentals sweep at 18:00 WIB: after the 17:00 fund NAV run, so the two
// daily jobs do not collide on the same cycle.
const FUNDAMENTALS_HOUR_WIB = Math.min(23, Math.max(0,
  Number(process.env.FUNDAMENTALS_HOUR_WIB ?? 18)))
```

Add to the imports: `import { refreshFundamentals } from '../services/fundamentals.js'`

- [ ] **Step 2: Add the once-per-day latch**

Alongside `let lastGoldRefreshMs = 0` in `main()`, add:

```ts
let lastFundamentalsDay: string | null = null
```

- [ ] **Step 3: Add the loop body**

Immediately after the existing daily fund NAV block (around line 181), add:

```ts
    // Daily fundamentals sweep (>= so a cycle landing after the hour still runs it)
    const wibNow = new Date().toLocaleString('en-CA', { timeZone: WIB, hour12: false })
    const wibDay = wibNow.slice(0, 10)
    const wibHour = Number(wibNow.slice(11, 13))
    if (wibHour >= FUNDAMENTALS_HOUR_WIB && lastFundamentalsDay !== wibDay) {
      lastFundamentalsDay = wibDay
      try {
        const rs = await refreshFundamentals()
        const ok = rs.filter((r) => !r.error).length
        console.log(`[runner] fundamentals refreshed ${ok}/${rs.length}`)
      } catch (err) {
        console.error('[runner] fundamentals refresh failed:', err)
      }
    }
```

- [ ] **Step 4: Verify typecheck and the full suite**

```bash
cd app && npm run typecheck && npm test
```
Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/graph/runner.ts
git commit -m "feat(runner): sweep fundamentals daily at 18:00 WIB"
```

---

### Task 9: Tab shell

**Files:**
- Create: `web/components/DetailTabs.tsx`
- Modify: `web/components/TickerDetail.tsx`
- Modify: `web/app/stocks/page.tsx` (pass `tab` through)
- Test: `web/components/DetailTabs.test.tsx`

**Interfaces:**
- Produces: `export const DETAIL_TABS`, `export function resolveTab(raw: string | undefined): TabId`, and the default-exported `DetailTabs` component.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { resolveTab, DETAIL_TABS } from './DetailTabs'

describe('resolveTab', () => {
  it('defaults to overview when absent', () => {
    expect(resolveTab(undefined)).toBe('overview')
  })

  it('accepts every declared tab id', () => {
    for (const t of DETAIL_TABS) expect(resolveTab(t.id)).toBe(t.id)
  })

  it('falls back to overview for an unknown or hostile value', () => {
    expect(resolveTab('financialz')).toBe('overview')
    expect(resolveTab('../../etc/passwd')).toBe('overview')
    expect(resolveTab('')).toBe('overview')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/DetailTabs.test.tsx`
Expected: FAIL, cannot resolve `./DetailTabs`.

- [ ] **Step 3: Implement**

```tsx
import Link from "next/link";

// Tab state lives in the URL, not client state: the detail page stays an async
// Server Component, tabs deep-link and survive the back button, and each render
// queries only the active tab's tables.

export const DETAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "actions", label: "Actions" },
  { id: "history", label: "History" },
] as const;

export type TabId = (typeof DETAIL_TABS)[number]["id"];

/** Never trust the query string: anything unrecognised falls back to overview. */
export function resolveTab(raw: string | undefined): TabId {
  const match = DETAIL_TABS.find((t) => t.id === raw);
  return match ? match.id : "overview";
}

export default function DetailTabs({
  active,
  hrefFor,
}: {
  active: TabId;
  hrefFor: (tab: TabId) => string;
}) {
  return (
    <nav className="border-b border-edge" aria-label="Detail sections">
      <ul className="flex gap-6">
        {DETAIL_TABS.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.id}>
              <Link
                href={hrefFor(t.id)}
                aria-current={on ? "page" : undefined}
                className={`-mb-px block border-b-2 px-1 pb-2 text-sm transition-colors duration-150 ${
                  on
                    ? "border-accent text-tprimary"
                    : "border-transparent text-tdim hover:text-tsecondary"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/DetailTabs.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire into TickerDetail**

In `web/components/TickerDetail.tsx`:
1. Add `tab` to the props: `{ ticker, backHref = "/stocks", tab }: { ticker: string; backHref?: string; tab?: string }`.
2. `const active = resolveTab(tab);`
3. Keep the header block (ticker, price, day change, position summary, freshness) and `PriceChart` rendering unconditionally, above the tabs.
4. Render `<DetailTabs active={active} hrefFor={(t) => \`${backHref}?ticker=${displayTicker(t2 = ticker)}&tab=${t}\`} />` where the ticker segment is the existing display form already used for links on this page.
5. Wrap the existing Transactions and Recommendation Accuracy sections in `{active === "history" && (...)}`.
6. Wrap the existing Fundamentals section in `{active === "overview" && (...)}` for now; Task 10 replaces its body.
7. Guard each tab's queries with the same condition so an inactive tab costs no SQL.

In `web/app/stocks/page.tsx`, widen the searchParams type to `{ ticker?: string; tab?: string }` and pass `tab={tab}` into `<TickerDetail />`.

- [ ] **Step 6: Neutralise the route loading skeleton**

A tab switch is a `searchParams` navigation on the same route, so Next.js
re-runs the server component and shows `web/app/stocks/loading.tsx`. That file
is currently shaped for the list page (a 6x5 table then a 5x4 table), so every
tab click would flash a list skeleton over the detail view.

Reshape it to a neutral shape that reads correctly for both:

```tsx
import { SkeletonBlock, SkeletonTable } from "@/components/Skeleton";

// Shared by the stocks list and the ticker detail view (tab switches are
// searchParams navigations on this same route), so the shape stays neutral:
// a heading, a metric strip, one table.
export default function StocksLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="h-8 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <SkeletonBlock className="h-3 w-16" />
            <SkeletonBlock className="mt-2 h-5 w-24" />
          </div>
        ))}
      </div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
```

If tab switches still feel like a full-page flash once real data is in, the
upgrade is to move each tab's query into its own async child component and wrap
it in `<Suspense key={active}>` so only the panel swaps. Do that only if the
simple version is visibly wrong; it costs three extra components.

- [ ] **Step 7: Verify the build and a manual click-through**

```bash
cd web && npx tsc --noEmit && npm run build
```
Expected: clean. Then `npm run dev`, open `/stocks?ticker=BBCA`, click each tab, confirm the URL gains `&tab=...`, the browser back button returns to the previous tab, the header stays visible on every tab, and no list-shaped skeleton flashes during the switch.

- [ ] **Step 8: Commit**

```bash
git add web/components/DetailTabs.tsx web/components/DetailTabs.test.tsx \
        web/components/TickerDetail.tsx web/app/stocks/page.tsx web/app/stocks/loading.tsx
git commit -m "feat(web): tab layout on the stock detail page"
```

---

### Task 10: Key Stats, Financials and Corporate Actions sections

**Files:**
- Create: `web/components/KeyStats.tsx`, `web/components/FinancialsTable.tsx`, `web/components/CorporateActions.tsx`
- Create: `web/components/KeyStats.test.tsx`
- Modify: `web/components/TickerDetail.tsx`

**Interfaces:**
- Consumes: `StockKeyStatsRow`, `StockFinancialRow`, `CorporateActionRow` (Task 2); `resolveTab` (Task 9).
- Produces: three default-exported presentational components, plus `export function statGroups(row)` from `KeyStats.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { statGroups } from './KeyStats'
import type { StockKeyStatsRow } from '@/lib/types'

const sparse = { ticker: 'BSSR.JK', fetched_at: '2026-09-07T00:00:00Z', price_to_book: 2.7 } as StockKeyStatsRow

describe('statGroups', () => {
  it('drops empty groups entirely rather than rendering a wall of N/A', () => {
    const groups = statGroups(sparse)
    expect(groups.map((g) => g.label)).toContain('Valuation')
    expect(groups.map((g) => g.label)).not.toContain('Street')
    expect(groups.map((g) => g.label)).not.toContain('Ownership')
  })

  it('keeps only the populated stats within a surviving group', () => {
    const valuation = statGroups(sparse).find((g) => g.label === 'Valuation')!
    expect(valuation.stats.map((s) => s.label)).toEqual(['P/B'])
  })

  it('renders every group when the payload is full', () => {
    const full = { ...sparse, forward_pe: 19.8, target_mean: 8194, analyst_count: 25,
                   return_on_equity: 0.182, held_pct_insiders: 0.549, current_ratio: 1.24 } as StockKeyStatsRow
    expect(statGroups(full).map((g) => g.label))
      .toEqual(['Valuation', 'Profitability', 'Health', 'Street', 'Ownership'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/KeyStats.test.tsx`
Expected: FAIL, cannot resolve `./KeyStats`.

- [ ] **Step 3: Implement KeyStats.tsx**

```tsx
import type { StockKeyStatsRow } from "@/lib/types";
import { fmtIdr, fmtAgo } from "@/lib/format";
import EmptyState from "./EmptyState";

type Stat = { label: string; value: string };
type Group = { label: string; stats: Stat[] };

const pct = (v: number | null | undefined, alreadyPct = false): string | null =>
  v == null ? null : `${(alreadyPct ? v : v * 100).toFixed(1)}%`;
const ratio = (v: number | null | undefined): string | null =>
  v == null ? null : v.toFixed(2);
const big = (v: number | null | undefined): string | null =>
  v == null ? null : fmtIdr(v);

/** Only populated stats survive, and an empty group is dropped whole. A thin
 *  small-cap gets a short card instead of a wall of N/A. */
export function statGroups(r: StockKeyStatsRow): Group[] {
  const raw: Group[] = [
    { label: "Valuation", stats: [
      { label: "Fwd P/E", value: ratio(r.forward_pe) },
      { label: "PEG", value: ratio(r.peg_ratio) },
      { label: "P/B", value: ratio(r.price_to_book) },
      { label: "EV", value: big(r.enterprise_value) },
      { label: "Book value", value: big(r.book_value) },
    ]},
    { label: "Profitability", stats: [
      { label: "ROE", value: pct(r.return_on_equity) },
      { label: "Net margin", value: pct(r.profit_margins) },
      { label: "EBITDA margin", value: pct(r.ebitda_margins) },
      { label: "Revenue growth", value: pct(r.revenue_growth) },
      { label: "EPS growth", value: pct(r.earnings_growth) },
    ]},
    { label: "Health", stats: [
      { label: "Current ratio", value: ratio(r.current_ratio) },
      { label: "Quick ratio", value: ratio(r.quick_ratio) },
      { label: "Total cash", value: big(r.total_cash) },
      { label: "Total debt", value: big(r.total_debt) },
      { label: "Free cash flow", value: big(r.free_cashflow) },
    ]},
    { label: "Street", stats: [
      { label: "Target", value: big(r.target_mean) },
      { label: "Range", value: r.target_low != null && r.target_high != null
        ? `${fmtIdr(r.target_low)} to ${fmtIdr(r.target_high)}` : null },
      { label: "Consensus", value: r.recommendation_key?.replace(/_/g, " ") ?? null },
      { label: "Analysts", value: r.analyst_count == null ? null : String(r.analyst_count) },
    ]},
    { label: "Ownership", stats: [
      { label: "Insiders", value: pct(r.held_pct_insiders) },
      { label: "Institutions", value: pct(r.held_pct_institutions) },
      { label: "Float", value: big(r.float_shares) },
      { label: "Shares out", value: big(r.shares_outstanding) },
      { label: "52w change", value: pct(r.change_52w) },
    ]},
  ].map((g) => ({
    label: g.label,
    stats: g.stats.filter((s): s is Stat => s.value != null),
  }));
  return raw.filter((g) => g.stats.length > 0);
}

const STALE_MS = 7 * 24 * 3_600_000;

export default function KeyStats({ row }: { row: StockKeyStatsRow | null }) {
  if (!row) return <EmptyState message="No key statistics fetched for this ticker yet." />;
  const groups = statGroups(row);
  if (groups.length === 0) {
    return <EmptyState message="No key statistics published for this ticker." />;
  }
  const stale = Date.now() - new Date(row.fetched_at).getTime() > STALE_MS;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-tprimary">Key Stats</h2>
        <span className={`text-xs ${stale ? "text-critical" : "text-tdim"}`}>
          {stale ? "stale, " : ""}synced {fmtAgo(row.fetched_at)} · yahoo-finance2
        </span>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 text-xs text-tdim">{g.label}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {g.stats.map((s) => (
                <div key={s.label}>
                  <div className="text-xs text-tdim">{s.label}</div>
                  <div className="num mt-0.5 text-sm font-semibold text-tprimary">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/KeyStats.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement FinancialsTable.tsx**

```tsx
import type { StockFinancialRow } from "@/lib/types";
import { fmtIdr, fmtAgo } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import EmptyState from "./EmptyState";

const STALE_MS = 7 * 24 * 3_600_000;

/** Quarter label from a period_end date: 2026-06-30 becomes Q2 2026. */
function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-");
  return `Q${Math.ceil(Number(m) / 3)} ${y}`;
}

/** Oldest-to-newest series for a column, or null when fewer than two points. */
function series(rows: StockFinancialRow[], key: "revenue" | "net_income"): number[] | null {
  const vals = rows.slice().reverse().map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length >= 2 ? vals : null;
}

/** Inline trend above the table: a row should communicate direction at a glance. */
function TrendRow({ rows }: { rows: StockFinancialRow[] }) {
  const revenue = series(rows, "revenue");
  const netIncome = series(rows, "net_income");
  if (!revenue && !netIncome) return null;
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {revenue && (
        <div>
          <div className="mb-1 text-xs text-tdim">Revenue trend</div>
          <Sparkline prices={revenue} />
        </div>
      )}
      {netIncome && (
        <div>
          <div className="mb-1 text-xs text-tdim">Net income trend</div>
          <Sparkline prices={netIncome} />
        </div>
      )}
    </div>
  );
}

export default function FinancialsTable({ rows }: { rows: StockFinancialRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="No quarterly financials published for this ticker." />;
  }
  const newest = rows[0]!;
  const stale = Date.now() - new Date(newest.fetched_at).getTime() > STALE_MS;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-tprimary">Quarterly Financials</h2>
        <span className={`text-xs ${stale ? "text-critical" : "text-tdim"}`}>
          {stale ? "stale, " : ""}synced {fmtAgo(newest.fetched_at)} · yahoo-finance2
        </span>
      </div>
      <TrendRow rows={rows} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-left text-xs text-tdim">
              <th className="py-2 font-normal">Quarter</th>
              <th className="py-2 text-right font-normal">Revenue</th>
              <th className="py-2 text-right font-normal">Net income</th>
              <th className="py-2 text-right font-normal">Net margin</th>
              <th className="py-2 text-right font-normal">EPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.period_end}-${r.period_type}`} className="border-b border-edge/50">
                <td className="py-2 text-tsecondary">{quarterLabel(r.period_end)}</td>
                <td className="num py-2 text-right text-tprimary">
                  {r.revenue == null ? "N/A" : fmtIdr(r.revenue)}
                </td>
                <td className={`num py-2 text-right ${
                  r.net_income == null ? "text-tprimary"
                    : r.net_income >= 0 ? "text-up" : "text-down"}`}>
                  {r.net_income == null ? "N/A"
                    : `${r.net_income >= 0 ? "▲ " : "▼ "}${fmtIdr(Math.abs(r.net_income))}`}
                </td>
                <td className="num py-2 text-right text-tsecondary">
                  {r.net_margin_pct == null ? "N/A" : `${r.net_margin_pct.toFixed(1)}%`}
                </td>
                <td className="num py-2 text-right text-tsecondary">
                  {r.eps == null ? "N/A" : r.eps.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {newest.currency && newest.currency !== "IDR" && (
        <p className="mt-2 text-xs text-tdim">
          Reported in {newest.currency}, not converted.
        </p>
      )}
    </section>
  );
}
```

Row padding is `py-2` on every `td`, per the project's table row-height standard.

- [ ] **Step 6: Implement CorporateActions.tsx**

```tsx
import type { CorporateActionRow } from "@/lib/types";
import { fmtIdr, fmtWibDate } from "@/lib/format";
import EmptyState from "./EmptyState";

const TYPE_LABEL: Record<CorporateActionRow["type"], string> = {
  DIVIDEND: "Dividend",
  SPLIT: "Split",
  RIGHTS: "Rights issue",
  BONUS: "Bonus shares",
  RUPS: "Shareholder meeting",
};

function describe(a: CorporateActionRow): string {
  if (a.type === "DIVIDEND") {
    const pay = typeof a.details.pay_date === "string" ? a.details.pay_date : null;
    const amount = a.amount == null ? "amount not announced" : `${fmtIdr(a.amount)} per share`;
    return pay ? `${amount}, paid ${fmtWibDate(pay)}` : amount;
  }
  if (a.type === "SPLIT" && a.ratio != null) {
    return a.ratio >= 1
      ? `1 share becomes ${a.ratio}`
      : `${Math.round(1 / a.ratio)} shares become 1`;
  }
  return a.source;
}

export default function CorporateActions({ rows }: { rows: CorporateActionRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="No corporate actions recorded for this ticker." />;
  }
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter((r) => r.event_date >= today);
  const past = rows.filter((r) => r.event_date < today);

  const List = ({ items, heading }: { items: CorporateActionRow[]; heading: string }) =>
    items.length === 0 ? null : (
      <div>
        <div className="mb-1.5 text-xs text-tdim">{heading}</div>
        <ul className="divide-y divide-edge/50">
          {items.map((a) => (
            <li key={`${a.type}-${a.event_date}`} className="flex items-baseline gap-3 py-2">
              <span className="num w-24 shrink-0 text-xs text-tdim">{fmtWibDate(a.event_date)}</span>
              <span className="w-36 shrink-0 text-sm text-tprimary">{TYPE_LABEL[a.type]}</span>
              <span className="text-sm text-tsecondary">{describe(a)}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section>
      <h2 className="mb-3 font-semibold text-tprimary">Corporate Actions</h2>
      <div className="space-y-4">
        <List items={upcoming.slice().reverse()} heading="Upcoming" />
        <List items={past} heading="Past" />
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Wire all three into TickerDetail**

Replace the Fundamentals section body with `<KeyStats row={keyStats} />` under `{active === "overview" && ...}`. Add `{active === "financials" && <FinancialsTable rows={financials} />}` and `{active === "actions" && <CorporateActions rows={actions} />}`.

Add the queries, each guarded so an inactive tab costs no SQL:

```tsx
const keyStats = active === "overview"
  ? ((await pool.query("SELECT * FROM stock_key_stats WHERE ticker = $1", [t]))
      .rows[0] ?? null) as StockKeyStatsRow | null
  : null;
const financials = active === "financials"
  ? (await pool.query(
      `SELECT * FROM stock_financials WHERE ticker = $1 AND period_type = 'QUARTERLY'
       ORDER BY period_end DESC LIMIT 8`, [t])).rows as StockFinancialRow[]
  : [];
const actions = active === "actions"
  ? (await pool.query(
      "SELECT * FROM corporate_actions_all WHERE ticker = $1 ORDER BY event_date DESC",
      [t])).rows as CorporateActionRow[]
  : [];
```

`t` is the normalized ticker already computed at the top of the component.

- [ ] **Step 8: Verify build and the full suite**

```bash
cd web && npx tsc --noEmit && npm test && npm run build
cd ../app && npm run typecheck && npm test
```
Expected: all clean.

- [ ] **Step 9: Populate real data and click through**

```bash
cd app && npm run fundamentals -- BBCA BSSR
```
Then `cd ../web && npm run dev`. Check `/stocks?ticker=BBCA&tab=financials` shows quarters, and `/stocks?ticker=BSSR&tab=financials` shows the empty state rather than an error. BSSR is the sparse-path check; do not skip it.

- [ ] **Step 10: Commit**

```bash
git add web/components/KeyStats.tsx web/components/KeyStats.test.tsx \
        web/components/FinancialsTable.tsx web/components/CorporateActions.tsx \
        web/components/TickerDetail.tsx
git commit -m "feat(web): key stats, quarterly financials and corporate actions sections"
```

---

### Task 11: Documentation

**Files:**
- Modify: `CLAUDE.md`, `.env.example`
- Create: `knowledge/tables/stock-key-stats.md`, `knowledge/tables/stock-financials.md`, `knowledge/tables/corporate-actions.md`, `knowledge/datasets/corporate-actions-all.md`
- Modify: `knowledge/index.md`, `knowledge/log.md`

- [ ] **Step 1: Update CLAUDE.md**

Add the three tables and the view to the `app/src/db/db.ts` bullet's table list. Add `app/src/services/fundamentals.ts` to the Architecture list and the project structure tree. Add `fundamentals` to the scripts line and the Running Locally block. Add `FUNDAMENTALS_HOUR_WIB` (default 18) to the env list. Add the three components to the `web/` bullet.

- [ ] **Step 2: Update .env.example**

Under the LangGraph orchestrator settings block add:

```
# Hour (WIB, 0-23) for the daily fundamentals sweep. After the 17:00 fund NAV run.
FUNDAMENTALS_HOUR_WIB=18
```

- [ ] **Step 3: Write the knowledge concept files**

One file per table plus one for the view, following the existing OKF v0.2 frontmatter exactly as `knowledge/tables/stock-snapshots.md` does: `type`, `title`, `description`, `resource`, `tags` (starting `postgres`), `generated: { by: human:marvellooni, at: <today ISO> }`, `status`. Body covers the columns, the source, the refresh cadence, and links to related concepts with `[[name]]`-style relative markdown links.

For `corporate-actions-all.md`, state plainly that it unions `dividend_schedule` with `corporate_actions` and why `dividend_schedule` was not migrated.

- [ ] **Step 4: Update knowledge/index.md and log.md**

Add the new concepts to the flow paragraph in `index.md`. Prepend a dated entry to `log.md` describing what was added and the coverage caveat (yahoo has no analyst or financial data for thin small-caps; columns are nullable by design).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .env.example knowledge/
git commit -m "docs: record fundamentals tables, service and env var"
```

---

## Done when

- `npm run fundamentals -- BBCA` populates all three tables.
- `/stocks?ticker=BBCA` shows four tabs; each deep-links and survives the back button; the price header stays visible on all four.
- `/stocks?ticker=BSSR&tab=financials` shows the empty state, not an error.
- `app`: typecheck clean, all tests pass. `web`: typecheck clean, tests pass, production build succeeds.
- Migration `039` applies to a fresh bootstrap and is idempotent on re-run.
