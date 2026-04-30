# PostgreSQL Migration & Ollama Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from SQLite to PostgreSQL, harden schema types, add Alembic for future migrations, fix Ollama context limits for Qwen3.5 compatibility.

**Architecture:** SQLAlchemy Core already abstracts the dialect — the migration is mostly infrastructure (Docker, config) and type hardening (Boolean, autoincrement). A one-shot Python script migrates existing data. Ollama params become env-configurable.

**Tech Stack:** PostgreSQL 18.3-alpine, SQLAlchemy Core, Alembic, psycopg2-binary, testcontainers (test only)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `app/db.py` | Schema hardening (Boolean, autoincrement), dialect-aware engine config |
| Modify | `app/fetch_portfolio.py` | Read `OLLAMA_NUM_CTX`/`OLLAMA_NUM_PREDICT` from env |
| Modify | `app/news.py` | Read Ollama env vars, use proportional defaults |
| Modify | `app/watchlist.py` | Read Ollama env vars, use proportional defaults |
| Modify | `docker/docker-compose.yml` | Add `idx-db` service, `depends_on`, network |
| Modify | `requirements.txt` | Uncomment psycopg2-binary, add alembic, testcontainers |
| Modify | `.env.example` | Add Postgres + Ollama config vars |
| Modify | `.gitignore` | Add `data/postgres/` |
| Create | `alembic.ini` | Alembic config (reads DATABASE_URL from env) |
| Create | `alembic/env.py` | Alembic env (imports app.db metadata) |
| Create | `alembic/versions/` | Empty dir for migration scripts |
| Create | `scripts/migrate_sqlite_to_postgres.py` | One-shot data migration script |
| Create | `tests/test_postgres_migration.py` | Integration test with testcontainers |
| Modify | `tests/test_db.py` | Add tests for Boolean column behavior |

---

### Task 1: Schema Hardening — Boolean Columns & Autoincrement

**Files:**
- Modify: `app/db.py:86-140` (table definitions)
- Modify: `app/db.py:14-18` (imports — add `Boolean`)
- Test: `tests/test_db.py`

- [ ] **Step 1: Write failing test for Boolean column behavior**

Add to `tests/test_db.py`:

```python
def test_boolean_columns_accept_true_false():
    """Boolean columns should accept Python True/False, not just 0/1."""
    upsert_position("TEST", 1000.0, 10, "bool test")
    positions = get_all_positions()
    assert len(positions) == 1
    assert positions[0]["active"] is True or positions[0]["active"] == 1

    deactivate_position("TEST")
    from app.db import get_engine, portfolio_positions
    with get_engine().connect() as conn:
        row = conn.execute(
            portfolio_positions.select().where(
                portfolio_positions.c.ticker == "TEST"
            )
        ).fetchone()
        val = dict(row._mapping)["active"]
        assert val is False or val == 0


def test_sent_telegram_boolean():
    sid = save_snapshot({"ticker": "BBCA", "current_price": 9000})
    save_analysis(sid, "BBCA", "test-model", "raw", "clean",
                  recommendation="HOLD", sent=True, skipped_same=False)
    from app.db import get_engine, llm_analyses
    with get_engine().connect() as conn:
        row = conn.execute(
            llm_analyses.select().where(llm_analyses.c.ticker == "BBCA")
        ).fetchone()
        mapping = dict(row._mapping)
        assert mapping["sent_telegram"] in (True, 1)
        assert mapping["skipped_same"] in (False, 0)
```

- [ ] **Step 2: Run tests to verify they pass with current schema**

Run: `pytest tests/test_db.py::test_boolean_columns_accept_true_false tests/test_db.py::test_sent_telegram_boolean -v`
Expected: PASS (current Integer 0/1 satisfies the `or` assertions)

- [ ] **Step 3: Update schema — add Boolean import and convert columns**

In `app/db.py`, add `Boolean` to the import:

```python
from sqlalchemy import (
    create_engine, MetaData, Table, Column,
    Integer, Float, String, DateTime, Text, Boolean,
    UniqueConstraint, ForeignKey, inspect, text
)
```

Change `llm_analyses` table (lines 96-97):
```python
    Column("sent_telegram",   Boolean, default=False),
    Column("skipped_same",    Boolean, default=False),
```

Change `portfolio_positions` table (line 136):
```python
    Column("active",    Boolean, default=True),
```

- [ ] **Step 4: Update save_analysis to pass booleans directly**

In `app/db.py` function `save_analysis` (line 280-281), change:
```python
                sent_telegram  = sent,
                skipped_same   = skipped_same,
```

(Remove the `1 if sent else 0` conversion — `Boolean` handles it.)

- [ ] **Step 5: Update upsert_portfolio to pass booleans directly**

In `app/db.py` function `upsert_portfolio`, change (lines 202, 210):
```python
                        active     = pos.get("active", True),
```

(Remove the `1 if pos.get("active", True) else 0` conversion.)

- [ ] **Step 6: Update upsert_position and deactivate_position**

In `upsert_position` (line 347):
```python
            conn.execute(
                portfolio_positions.update()
                .where(portfolio_positions.c.ticker == ticker.upper())
                .values(avg_price=avg_price, lots=lots, active=True,
                        notes=notes, updated_at=now)
            )
```

And the insert (line 354):
```python
                    ticker=ticker.upper(), avg_price=avg_price,
                    lots=lots, active=True, notes=notes, updated_at=now,
```

In `deactivate_position` (line 365):
```python
            .values(active=False, updated_at=datetime.now(timezone.utc))
```

- [ ] **Step 7: Run all tests**

Run: `pytest tests/test_db.py -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add app/db.py tests/test_db.py
git commit -m "refactor(db): convert integer booleans to SQLAlchemy Boolean type"
```

---

### Task 2: Dialect-Aware Engine Configuration

**Files:**
- Modify: `app/db.py:28-39` (get_engine function)
- Test: `tests/test_db.py`

- [ ] **Step 1: Write test for SQLite engine configuration**

Add to `tests/test_db.py`:

```python
def test_engine_is_sqlite_in_tests():
    """Verify test engine uses SQLite dialect."""
    eng = get_engine()
    assert eng.dialect.name == "sqlite"
```

- [ ] **Step 2: Run test**

Run: `pytest tests/test_db.py::test_engine_is_sqlite_in_tests -v`
Expected: PASS

- [ ] **Step 3: Refactor get_engine for dialect awareness**

Replace `get_engine()` in `app/db.py`:

```python
def get_engine():
    global engine
    if engine is None:
        db_url = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")
        is_sqlite = db_url.startswith("sqlite")

        if is_sqlite:
            connect_args = {"check_same_thread": False}
            engine = create_engine(db_url, connect_args=connect_args, echo=False)
            if db_url != "sqlite://":
                with engine.connect() as conn:
                    conn.execute(text("PRAGMA journal_mode=WAL"))
                    conn.execute(text("PRAGMA busy_timeout=5000"))
        else:
            engine = create_engine(
                db_url,
                echo=False,
                pool_size=5,
                pool_pre_ping=True,
            )
    return engine
```

- [ ] **Step 4: Run all tests**

Run: `pytest tests/test_db.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add app/db.py tests/test_db.py
git commit -m "refactor(db): dialect-aware engine config with Postgres pool settings"
```

---

### Task 3: Ollama Context Configuration

**Files:**
- Modify: `app/fetch_portfolio.py:44-45,407-410`
- Modify: `app/news.py:26-27,280`
- Modify: `app/watchlist.py:19-20,124`
- Modify: `.env.example`

- [ ] **Step 1: Add env vars to fetch_portfolio.py**

After line 45 in `app/fetch_portfolio.py`, add:

```python
OLLAMA_NUM_CTX     = int(os.getenv("OLLAMA_NUM_CTX",     "16384"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "4096"))
```

Update `call_ollama()` options block (lines 407-410):

```python
                "options": {
                    "temperature": 0.3,
                    "num_predict": OLLAMA_NUM_PREDICT,
                    "num_ctx":     OLLAMA_NUM_CTX,
                },
```

- [ ] **Step 2: Add env vars to news.py**

After line 27 in `app/news.py`, add:

```python
OLLAMA_NUM_CTX     = int(os.getenv("OLLAMA_NUM_CTX",     "16384"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "4096"))
```

Update the options in `summarize_news()` (line 280):

```python
                "options": {"temperature": 0.2, "num_predict": OLLAMA_NUM_PREDICT // 8, "num_ctx": OLLAMA_NUM_CTX // 4},
```

- [ ] **Step 3: Add env vars to watchlist.py**

After line 20 in `app/watchlist.py`, add:

```python
OLLAMA_NUM_CTX     = int(os.getenv("OLLAMA_NUM_CTX",     "16384"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "4096"))
```

Update `_call_ollama()` options (line 124):

```python
            "options": {"temperature": 0.3, "num_predict": OLLAMA_NUM_PREDICT // 4, "num_ctx": OLLAMA_NUM_CTX // 2},
```

- [ ] **Step 4: Update .env.example**

Add after the `OLLAMA_MODEL` line:

```bash
OLLAMA_NUM_CTX=16384
OLLAMA_NUM_PREDICT=4096
```

- [ ] **Step 5: Commit**

```bash
git add app/fetch_portfolio.py app/news.py app/watchlist.py .env.example
git commit -m "feat(ollama): make num_ctx and num_predict configurable via env vars"
```

---

### Task 4: Docker Infrastructure — PostgreSQL Service

**Files:**
- Modify: `docker/docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Add idx-db service to docker-compose.yml**

Add before the `idx-bot` service:

```yaml
  # ── PostgreSQL database ──
  idx-db:
    image: postgres:18.3-alpine
    container_name: idx-db
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

- [ ] **Step 2: Add depends_on and network to all app services**

Add to `idx-bot`, `idx-ui`, and `idx-graph`:

```yaml
    depends_on:
      idx-db:
        condition: service_healthy
    networks:
      - idx-net
```

- [ ] **Step 3: Add networks block at bottom of docker-compose.yml**

```yaml
networks:
  idx-net:
    driver: bridge
```

- [ ] **Step 4: Update .env.example with Postgres vars**

Replace the commented DATABASE_URL section with:

```bash
# Database — PostgreSQL (Docker) or SQLite (local dev)
DATABASE_URL=postgresql://idx:changeme@idx-db:5432/idx_portfolio
POSTGRES_USER=idx
POSTGRES_PASSWORD=changeme
POSTGRES_DB=idx_portfolio
```

- [ ] **Step 5: Add data/postgres/ to .gitignore**

Add after the `!data/json/` line:

```
data/postgres/
```

- [ ] **Step 6: Commit**

```bash
git add docker/docker-compose.yml .env.example .gitignore
git commit -m "feat(docker): add PostgreSQL service with health check and networking"
```

---

### Task 5: Alembic Setup

**Files:**
- Create: `alembic.ini`
- Create: `alembic/env.py`
- Create: `alembic/script.py.mako`
- Create: `alembic/versions/.gitkeep`
- Modify: `requirements.txt`
- Modify: `app/graph/runner.py`

- [ ] **Step 1: Add alembic to requirements.txt**

Uncomment psycopg2-binary and add alembic:

```
psycopg2-binary>=2.9.0
alembic>=1.13.0
```

Also add testcontainers for Task 7:

```
testcontainers>=4.0.0
```

Full `requirements.txt`:

```
yfinance==1.3.0
requests>=2.31.0
python-dotenv>=1.0.0
pandas>=2.0.0
numpy>=1.26.0
sqlalchemy>=2.0.0
streamlit>=1.35.0
psycopg2-binary>=2.9.0
alembic>=1.13.0
langgraph>=0.4.0
langchain-core>=0.3.0
feedparser>=6.0.0

# Dev dependencies
pytest>=9.0.0
ruff>=0.4.0
testcontainers>=4.0.0
```

- [ ] **Step 2: Create alembic.ini**

Create `alembic.ini` in project root:

```ini
[alembic]
script_location = alembic
sqlalchemy.url = %(DATABASE_URL)s

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 3: Create alembic/env.py**

```python
import os
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

load_dotenv()

config = context.config
config.set_main_option(
    "sqlalchemy.url",
    os.getenv("DATABASE_URL", "sqlite:///./data/app.db"),
)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from app.db import metadata as target_metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4: Create alembic/script.py.mako**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 5: Create alembic/versions/.gitkeep**

Create empty file `alembic/versions/.gitkeep`.

- [ ] **Step 6: Add Alembic upgrade to graph runner startup**

In `app/graph/runner.py`, add after `init_db()` (line 31):

```python
    # Run pending Alembic migrations
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url.startswith("sqlite"):
        try:
            from alembic.config import Config
            from alembic import command
            alembic_cfg = Config("alembic.ini")
            alembic_cfg.set_main_option("sqlalchemy.url", db_url)
            command.upgrade(alembic_cfg, "head")
            log.info("Alembic migrations applied")
        except Exception as e:
            log.warning(f"Alembic migration skipped: {e}")
```

Add `import os` to the imports if not present.

- [ ] **Step 7: Commit**

```bash
git add alembic.ini alembic/ requirements.txt app/graph/runner.py
git commit -m "feat(alembic): add Alembic migration framework with auto-upgrade on startup"
```

---

### Task 6: Data Migration Script

**Files:**
- Create: `scripts/migrate_sqlite_to_postgres.py`

- [ ] **Step 1: Create scripts directory**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write migration script**

Create `scripts/migrate_sqlite_to_postgres.py`:

```python
#!/usr/bin/env python3
"""
One-shot migration: SQLite → PostgreSQL.

Usage:
    DATABASE_URL=postgresql://idx:pass@localhost:5432/idx_portfolio \
    python -m scripts.migrate_sqlite_to_postgres

Safety:
    - Refuses to run if target tables contain data
    - SQLite file is preserved as backup
    - Prints row counts for verification
"""

import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text, inspect

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db import metadata, portfolio_positions, stock_snapshots, llm_analyses, news_cache, news_sentiments

SQLITE_URL = "sqlite:///./data/app.db"

TABLES_IN_ORDER = [
    portfolio_positions,
    stock_snapshots,
    llm_analyses,
    news_cache,
    news_sentiments,
]


def migrate():
    target_url = os.getenv("DATABASE_URL")
    if not target_url or target_url.startswith("sqlite"):
        print("ERROR: DATABASE_URL must be set to a PostgreSQL URL")
        sys.exit(1)

    src = create_engine(SQLITE_URL)
    dst = create_engine(target_url)

    if not os.path.exists("data/app.db"):
        print("ERROR: SQLite database not found at data/app.db")
        sys.exit(1)

    metadata.create_all(dst)
    print(f"Target tables created: {dst.url}")

    with dst.connect() as conn:
        for table in TABLES_IN_ORDER:
            count = conn.execute(text(f"SELECT COUNT(*) FROM {table.name}")).scalar()
            if count > 0:
                print(f"ERROR: Target table '{table.name}' already has {count} rows. Aborting.")
                sys.exit(1)

    with src.connect() as src_conn, dst.begin() as dst_conn:
        for table in TABLES_IN_ORDER:
            rows = src_conn.execute(table.select()).fetchall()
            if not rows:
                print(f"  {table.name}: 0 rows (empty)")
                continue

            data = [dict(r._mapping) for r in rows]
            dst_conn.execute(table.insert(), data)
            print(f"  {table.name}: {len(data)} rows migrated")

    with dst.begin() as conn:
        for table in TABLES_IN_ORDER:
            pk_col = table.primary_key.columns.values()[0]
            if pk_col.type.__class__.__name__ == "Integer":
                max_id = conn.execute(
                    text(f"SELECT COALESCE(MAX({pk_col.name}), 0) FROM {table.name}")
                ).scalar()
                seq_name = f"{table.name}_{pk_col.name}_seq"
                try:
                    conn.execute(text(f"SELECT setval('{seq_name}', {max_id + 1}, false)"))
                    print(f"  Sequence {seq_name} reset to {max_id + 1}")
                except Exception:
                    pass

    print("\nMigration complete. Verify row counts above.")
    print("SQLite file preserved at data/app.db as backup.")


if __name__ == "__main__":
    migrate()
```

- [ ] **Step 3: Create scripts/__init__.py**

Create empty `scripts/__init__.py`.

- [ ] **Step 4: Commit**

```bash
git add scripts/
git commit -m "feat(migration): add one-shot SQLite to PostgreSQL migration script"
```

---

### Task 7: Integration Tests

**Files:**
- Create: `tests/test_postgres_migration.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Write Postgres integration test**

Create `tests/test_postgres_migration.py`:

```python
"""
Integration tests for PostgreSQL compatibility.
Requires Docker — skipped automatically if unavailable.
"""

import os
import subprocess
import sys

import pytest

try:
    from testcontainers.postgres import PostgresContainer
    HAS_TESTCONTAINERS = True
except ImportError:
    HAS_TESTCONTAINERS = False

HAS_DOCKER = False
if HAS_TESTCONTAINERS:
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        HAS_DOCKER = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

pytestmark = pytest.mark.skipif(
    not (HAS_TESTCONTAINERS and HAS_DOCKER),
    reason="Requires testcontainers + Docker"
)


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:18.3-alpine") as pg:
        yield pg.get_connection_url()


@pytest.fixture(autouse=True)
def set_db_url(postgres_url, monkeypatch):
    import app.db
    monkeypatch.setattr(app.db, "engine", None)
    monkeypatch.setenv("DATABASE_URL", postgres_url)


def test_init_db_creates_tables_on_postgres(postgres_url):
    os.environ["DATABASE_URL"] = postgres_url
    import app.db
    app.db.engine = None
    app.db.init_db()

    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(app.db.get_engine())
    table_names = inspector.get_table_names()

    assert "stock_snapshots" in table_names
    assert "llm_analyses" in table_names
    assert "portfolio_positions" in table_names
    assert "news_cache" in table_names
    assert "news_sentiments" in table_names


def test_crud_operations_on_postgres(postgres_url):
    os.environ["DATABASE_URL"] = postgres_url
    import app.db
    app.db.engine = None
    app.db.init_db()

    app.db.upsert_position("BBCA", 8674.55, 57, "test")
    positions = app.db.get_all_positions()
    assert len(positions) == 1
    assert positions[0]["ticker"] == "BBCA"
    assert positions[0]["active"] is True

    sid = app.db.save_snapshot({"ticker": "BBCA", "current_price": 9000})
    assert sid > 0

    aid = app.db.save_analysis(sid, "BBCA", "test-model", "raw", "clean",
                                recommendation="HOLD", sent=True, skipped_same=False)
    assert aid > 0

    analysis = app.db.get_latest_analysis("BBCA")
    assert analysis is not None
    assert analysis["sent_telegram"] is True
    assert analysis["skipped_same"] is False
```

- [ ] **Step 2: Run integration test (if Docker available)**

Run: `pytest tests/test_postgres_migration.py -v`
Expected: PASS (or SKIP if no Docker)

- [ ] **Step 3: Run full test suite**

Run: `pytest tests/ -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/test_postgres_migration.py
git commit -m "test(postgres): add integration tests with testcontainers"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -v
```

Expected: All PASS

- [ ] **Step 2: Verify docker-compose syntax**

```bash
docker compose -f docker/docker-compose.yml config
```

Expected: Valid YAML output, no errors

- [ ] **Step 3: Verify Alembic can read metadata**

```bash
DATABASE_URL=sqlite:///./data/app.db python -c "from alembic.config import Config; from alembic import command; cfg = Config('alembic.ini'); print('Alembic OK')"
```

Expected: `Alembic OK`

- [ ] **Step 4: Final commit (if any remaining changes)**

```bash
git status
```

If clean: done. If changes remain, stage and commit with appropriate message.
