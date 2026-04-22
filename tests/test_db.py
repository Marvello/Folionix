import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Use in-memory SQLite for tests
os.environ["DATABASE_URL"] = "sqlite://"

from app.db import (
    init_db, upsert_position, deactivate_position,
    get_all_positions, get_all_latest_snapshots,
    get_analyses, sync_portfolio_json,
    save_snapshot, save_analysis, get_engine, metadata,
)

def setup_function():
    """Reset DB before each test."""
    metadata.drop_all(get_engine())
    init_db()

def test_upsert_and_get_positions():
    upsert_position("BBCA", 8674.55, 57, "blue chip")
    upsert_position("BBRI", 4300.50, 133, "microfinance")
    positions = get_all_positions()
    assert len(positions) == 2
    bbca = next(p for p in positions if p["ticker"] == "BBCA")
    assert bbca["avg_price"] == 8674.55
    assert bbca["lots"] == 57

def test_upsert_updates_existing():
    upsert_position("BBCA", 8674.55, 57, "blue chip")
    upsert_position("BBCA", 9000.00, 60, "updated")
    positions = get_all_positions()
    assert len(positions) == 1
    assert positions[0]["avg_price"] == 9000.00
    assert positions[0]["lots"] == 60

def test_deactivate_position():
    upsert_position("BBCA", 8674.55, 57, "blue chip")
    deactivate_position("BBCA")
    positions = get_all_positions()
    assert len(positions) == 0

def test_get_all_latest_snapshots():
    id1 = save_snapshot({"ticker": "BBCA", "current_price": 9000})
    id2 = save_snapshot({"ticker": "BBCA", "current_price": 9100})
    save_snapshot({"ticker": "BBRI", "current_price": 4500})
    snaps = get_all_latest_snapshots()
    assert len(snaps) == 2
    bbca = next(s for s in snaps if s["ticker"] == "BBCA")
    assert bbca["current_price"] == 9100

def test_get_analyses():
    sid = save_snapshot({"ticker": "BBCA", "current_price": 9000})
    save_analysis(sid, "BBCA", "gemma4", "raw1", "clean1", recommendation="HOLD")
    save_analysis(sid, "BBCA", "gemma4", "raw2", "clean2", recommendation="BUY")
    results = get_analyses("BBCA", limit=10)
    assert len(results) == 2
    assert results[0]["recommendation"] == "BUY"  # most recent first

def test_sync_portfolio_json():
    upsert_position("BBCA", 8674.55, 57, "blue chip")
    upsert_position("BBRI", 4300.50, 133, "microfinance")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        path = f.name
    try:
        sync_portfolio_json(path)
        with open(path) as f:
            data = json.load(f)
        assert len(data["positions"]) == 2
        tickers = {p["ticker"] for p in data["positions"]}
        assert tickers == {"BBCA", "BBRI"}
    finally:
        os.unlink(path)
