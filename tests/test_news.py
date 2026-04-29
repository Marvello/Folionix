"""Tests for news module — cache tables, fetch, summarize."""

import os
os.environ["DATABASE_URL"] = "sqlite://"

from datetime import datetime, timezone
from app.db import init_db, get_engine, metadata, news_cache, news_sentiments


def test_news_cache_table_exists():
    init_db()
    engine = get_engine()
    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    assert "news_cache" in tables


def test_news_sentiments_table_exists():
    init_db()
    engine = get_engine()
    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    assert "news_sentiments" in tables
