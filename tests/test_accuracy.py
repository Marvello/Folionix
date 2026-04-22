import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["DATABASE_URL"] = "sqlite://"

from datetime import datetime, timezone, timedelta
from app.db import (init_db, save_snapshot, save_analysis, get_recommendation_accuracy,
                    get_engine, metadata)


def setup_function():
    metadata.drop_all(get_engine())
    init_db()


def test_accuracy_bullish_correct():
    """BUY recommendation followed by price increase = correct"""
    t1 = datetime(2026, 4, 15, 9, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 4, 18, 9, 0, tzinfo=timezone.utc)  # 3 days later

    # Save snapshot at recommendation time
    sid1 = save_snapshot({"ticker": "BBCA", "current_price": 9000})
    # Manually update fetched_at for test
    from sqlalchemy import update
    with get_engine().begin() as conn:
        conn.execute(update(metadata.tables["stock_snapshots"]).where(
            metadata.tables["stock_snapshots"].c.id == sid1
        ).values(fetched_at=t1))

    # Save analysis
    save_analysis(sid1, "BBCA", "test", "raw", "clean", recommendation="BUY")
    from sqlalchemy import update as upd
    with get_engine().begin() as conn:
        conn.execute(upd(metadata.tables["llm_analyses"]).where(
            metadata.tables["llm_analyses"].c.snapshot_id == sid1
        ).values(analysed_at=t1))

    # Save snapshot 3 days later with higher price
    sid2 = save_snapshot({"ticker": "BBCA", "current_price": 9500})
    with get_engine().begin() as conn:
        conn.execute(update(metadata.tables["stock_snapshots"]).where(
            metadata.tables["stock_snapshots"].c.id == sid2
        ).values(fetched_at=t2))

    results = get_recommendation_accuracy(days_after=3)
    assert len(results) == 1
    assert results[0]["correct"] is True
    assert results[0]["actual_change_pct"] > 0


def test_accuracy_no_data():
    """Empty DB returns empty results"""
    results = get_recommendation_accuracy()
    assert results == []
