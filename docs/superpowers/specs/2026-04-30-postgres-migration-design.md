# PostgreSQL Migration & Ollama Config

**Date:** 2026-04-30
**Status:** Draft
**Scope:** Migrate SQLite → PostgreSQL, harden schema, add Alembic, fix Ollama context limits

---

## Motivation

- Production readiness: SQLite not suitable for multi-service Docker deployment long-term
- Future feature expansion: need proper RDBMS foundation
- Ollama model compatibility: Qwen3.5 hits context limits with current hardcoded values

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PostgreSQL version | 18.3-alpine | Latest stable, minimal image |
| Redis | Skip | No concrete use case; revisit when needed |
| Volume | Bind mount `data/postgres/` | Consistent with existing `data/` convention |
| Migration | One-shot script, SQLite preserved | Small dataset (36KB), simple transfer |
| Schema changes | Boolean types, autoincrement, dialect-safe defaults | Proper Postgres types |
| Future migrations | Alembic with autogenerate | Schema evolution without manual DDL |
| Local dev | SQLite fallback preserved | `DATABASE_URL` unset = SQLite |
| Ollama limits | Configurable via env vars | Model compatibility across Qwen/Llama/etc |

## Out of Scope

- Redis (no use case)
- Multi-user auth / advanced connection pooling
- Postgres replication / backups
- Schema redesign (tables stay as-is, type hardening only)

---

## 1. Infrastructure: PostgreSQL in Docker

### docker-compose.yml

Add `idx-db` service:

```yaml
idx-db:
  image: postgres:18.3-alpine
  restart: unless-stopped
  env_file: ../.env
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-idx}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB:-idx_portfolio}
  volumes:
    - ../data/postgres:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-idx}"]
    interval: 10s
    timeout: 5s
    retries: 5
  networks:
    - idx-net
```

All app services add:

```yaml
depends_on:
  idx-db:
    condition: service_healthy
```

### Networking

- PostgreSQL exposed only on internal Docker network (`idx-net`), not host
- App services connect via `idx-db:5432` hostname

### DATABASE_URL

```
postgresql://idx:password@idx-db:5432/idx_portfolio
```

### .gitignore

Add `data/postgres/`

---

## 2. Schema Hardening

### Boolean columns

Convert integer `0/1` to SQLAlchemy `Boolean`:

- `stock_snapshots.is_valid`
- `llm_analyses.telegram_sent`
- `llm_analyses.skipped_same`
- `portfolio_positions.active`

SQLAlchemy `Boolean` maps to `INTEGER` on SQLite and `BOOLEAN` on Postgres automatically. No app code changes needed.

### Primary keys

Add explicit `autoincrement=True` on all Integer PKs. SQLite does this implicitly; Postgres needs `SERIAL`/`IDENTITY`.

### Timestamps

Replace any SQLite-specific `datetime('now')` server defaults with `func.now()` (cross-dialect).

---

## 3. Alembic Setup

### Structure

```
alembic/
├── alembic.ini          # reads DATABASE_URL from env
├── env.py               # imports app.db metadata for autogenerate
└── versions/            # migration scripts
```

### Configuration

- `sqlalchemy.url` reads from `DATABASE_URL` env var
- `env.py` imports `metadata` from `app.db` for `--autogenerate`
- Initial revision generated after first Postgres deploy as baseline

### Workflow

1. Change schema in `app/db.py`
2. `alembic revision --autogenerate -m "description"`
3. Review generated migration
4. `alembic upgrade head`

### Docker integration

`idx-graph` runs `alembic upgrade head` on startup before app logic.

---

## 4. Data Migration (SQLite → PostgreSQL)

### Script: `scripts/migrate_sqlite_to_postgres.py`

**Process:**
1. Read all rows from SQLite via SQLAlchemy (source: `sqlite:///./data/app.db`)
2. Write to PostgreSQL via SQLAlchemy (target: `DATABASE_URL`)
3. Table order respects foreign keys: `portfolio_positions` → `stock_snapshots` → `llm_analyses` → `news_cache` → `news_sentiments`
4. Bulk insert with `executemany`
5. Reset PK sequences to `max(id) + 1`

**Safety:**
- Idempotent: checks if target tables are empty before inserting
- Refuses to run if target has data (prevents double-migration)
- Prints row counts per table for verification

**Not included:**
- No incremental sync — one-shot, then SQLite retired
- No rollback script — SQLite file preserved as natural backup

---

## 5. App Layer Changes

### `app/db.py`

- `get_engine()`: dialect check — apply SQLite pragmas (WAL, busy_timeout, check_same_thread) only for SQLite. Add Postgres pool config: `pool_size=5`, `pool_pre_ping=True`
- Schema column types updated per Section 2

### `requirements.txt`

- Uncomment `psycopg2-binary`
- Add `alembic`

### `.env.example`

- Uncomment `DATABASE_URL` PostgreSQL example
- Add `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`

### No changes to consumer modules

All 9 modules using `app.db` are dialect-agnostic via SQLAlchemy Core:
- `app/fetch_portfolio.py`
- `app/analyze_watchlist.py`
- `app/bot.py`
- `app/ui.py`
- `app/news.py`
- `app/watchlist.py`
- `app/graph/orchestrator.py`
- `app/graph/analysis.py`
- `app/graph/runner.py`

---

## 6. Ollama Context Configuration

### Problem

Switching to Qwen3.5:latest causes `done_reason: length` — model hits output token limit with hardcoded `num_predict: 2048` and `num_ctx: 8192`.

### Fix

Make Ollama generation params configurable via `.env`:

| Env var | Default | Current hardcoded |
|---------|---------|-------------------|
| `OLLAMA_NUM_CTX` | 16384 | 8192 |
| `OLLAMA_NUM_PREDICT` | 4096 | 2048 |

### Files affected

- `app/fetch_portfolio.py` — main `call_ollama()` (line ~407)
- `app/news.py` — sentiment summarization (line ~280)
- `app/watchlist.py` — ticker suggestions (line ~124)

All three read from env vars with sensible defaults. Individual call sites use fractions of the global default where appropriate (e.g., news sentiment: `num_ctx = OLLAMA_NUM_CTX // 4`, `num_predict = OLLAMA_NUM_PREDICT // 8`).

### .env.example

```bash
OLLAMA_NUM_CTX=16384
OLLAMA_NUM_PREDICT=4096
```

---

## 7. Testing Strategy

### Existing tests

Continue running against SQLite (fast, no infra). Default `DATABASE_URL` unset = SQLite.

### New integration test: `tests/test_postgres_migration.py`

- Uses `testcontainers` to spin up ephemeral Postgres container
- Verifies `init_db()` creates all tables on Postgres
- Verifies migration script transfers data accurately
- `@pytest.mark.skipif` when Docker unavailable

### Manual verification checklist

- [ ] `docker compose up idx-db` — Postgres healthy
- [ ] Run migration script — row counts match
- [ ] `docker compose up` — all services connect to Postgres
- [ ] Run full analysis cycle — snapshots + analyses saved
- [ ] Streamlit dashboard reads data correctly
- [ ] Telegram bot responds to `/status`
- [ ] Switch Ollama model to Qwen3.5 — no empty response error
