"""
Integration tests for PostgreSQL compatibility.
Requires Docker — skipped automatically if unavailable.
"""

import os
import subprocess

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
    reason="Requires testcontainers + Docker",
)


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url()


@pytest.fixture(autouse=True)
def reset_engine(postgres_url):
    """Reset the global engine before each test so it picks up DATABASE_URL."""
    import app.db

    old_engine = app.db.engine
    old_url = os.environ.get("DATABASE_URL")

    app.db.engine = None
    os.environ["DATABASE_URL"] = postgres_url

    yield

    # Restore previous state
    app.db.engine = old_engine
    if old_url is not None:
        os.environ["DATABASE_URL"] = old_url
    else:
        os.environ.pop("DATABASE_URL", None)


def test_init_db_creates_tables_on_postgres():
    import app.db

    app.db.init_db()

    from sqlalchemy import inspect as sa_inspect

    inspector = sa_inspect(app.db.get_engine())
    table_names = inspector.get_table_names()

    assert "stock_snapshots" in table_names
    assert "llm_analyses" in table_names
    assert "portfolio_positions" in table_names
    assert "news_cache" in table_names
    assert "news_sentiments" in table_names


def test_crud_operations_on_postgres():
    import app.db

    app.db.init_db()

    # Upsert a position and verify
    app.db.upsert_position("BBCA", 8674.55, 57, "test")
    positions = app.db.get_all_positions()
    assert len(positions) == 1
    assert positions[0]["ticker"] == "BBCA"
    assert positions[0]["active"] is True

    # Save a snapshot and verify
    sid = app.db.save_snapshot({"ticker": "BBCA", "current_price": 9000})
    assert sid > 0

    # Save an analysis and verify
    aid = app.db.save_analysis(
        sid,
        "BBCA",
        "test-model",
        "raw",
        "clean",
        recommendation="HOLD",
        sent=True,
        skipped_same=False,
    )
    assert aid > 0

    # Fetch latest analysis and check boolean columns
    analysis = app.db.get_latest_analysis("BBCA")
    assert analysis is not None
    assert analysis["sent_telegram"] is True
    assert analysis["skipped_same"] is False


def test_deactivate_position_on_postgres():
    import app.db

    app.db.init_db()

    app.db.upsert_position("TLKM", 3500.0, 10, "deactivation test")
    positions = app.db.get_all_positions()
    assert any(p["ticker"] == "TLKM" for p in positions)

    app.db.deactivate_position("TLKM")
    positions = app.db.get_all_positions()
    assert not any(p["ticker"] == "TLKM" for p in positions)
