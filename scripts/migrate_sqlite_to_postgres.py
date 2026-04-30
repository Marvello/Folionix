#!/usr/bin/env python3
"""
One-shot migration: SQLite -> PostgreSQL.

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
from sqlalchemy import create_engine, text

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db import (
    metadata,
    portfolio_positions,
    stock_snapshots,
    llm_analyses,
    news_cache,
    news_sentiments,
)

SQLITE_URL = "sqlite:///./data/app.db"

# Insert order respects foreign keys: stock_snapshots before llm_analyses
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

    # Create tables in target database
    metadata.create_all(dst)
    print(f"Target tables created: {dst.url}")

    # Safety check: refuse to run if target tables have data
    with dst.connect() as conn:
        for table in TABLES_IN_ORDER:
            count = conn.execute(
                text(f"SELECT COUNT(*) FROM {table.name}")
            ).scalar()
            if count > 0:
                print(
                    f"ERROR: Target table '{table.name}' already has "
                    f"{count} rows. Aborting."
                )
                sys.exit(1)

    # Migrate data table by table
    with src.connect() as src_conn, dst.begin() as dst_conn:
        for table in TABLES_IN_ORDER:
            rows = src_conn.execute(table.select()).fetchall()
            if not rows:
                print(f"  {table.name}: 0 rows (empty)")
                continue

            data = [dict(r._mapping) for r in rows]
            dst_conn.execute(table.insert(), data)
            print(f"  {table.name}: {len(data)} rows migrated")

    # Reset PostgreSQL sequences to avoid PK conflicts on next insert
    with dst.begin() as conn:
        for table in TABLES_IN_ORDER:
            pk_col = table.primary_key.columns.values()[0]
            if pk_col.type.__class__.__name__ == "Integer":
                max_id = conn.execute(
                    text(
                        f"SELECT COALESCE(MAX({pk_col.name}), 0) "
                        f"FROM {table.name}"
                    )
                ).scalar()
                seq_name = f"{table.name}_{pk_col.name}_seq"
                try:
                    conn.execute(
                        text(
                            f"SELECT setval('{seq_name}', {max_id + 1}, false)"
                        )
                    )
                    print(f"  Sequence {seq_name} reset to {max_id + 1}")
                except Exception:
                    pass

    print("\nMigration complete. Verify row counts above.")
    print("SQLite file preserved at data/app.db as backup.")


if __name__ == "__main__":
    migrate()
