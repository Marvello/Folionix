"""
db.py — Database layer for IDX Portfolio Analyzer
--------------------------------------------------
Uses SQLAlchemy Core so swapping SQLite → Postgres
is a single env var change:

  SQLite  (default): DATABASE_URL=sqlite:///./idx_portfolio.db
  Postgres (later) : DATABASE_URL=postgresql://user:pass@host:5432/idx_portfolio
"""

import json
import os
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine, MetaData, Table, Column,
    Integer, Float, String, DateTime, Text,
    UniqueConstraint, inspect, text
)
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./idx_portfolio.db")

# connect_args only needed for SQLite (thread safety)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine  = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)
metadata = MetaData()

# ──────────────────────────────────────────────
# TABLE DEFINITIONS
# ──────────────────────────────────────────────

# Raw market snapshots — one row per ticker per fetch
stock_snapshots = Table(
    "stock_snapshots", metadata,
    Column("id",                 Integer, primary_key=True, autoincrement=True),
    Column("fetched_at",         DateTime, nullable=False, index=True),
    Column("ticker",             String(10), nullable=False, index=True),
    Column("symbol",             String(15)),
    Column("name",               String(100)),
    Column("sector",             String(80)),
    Column("industry",           String(80)),
    # price
    Column("current_price",      Float),
    Column("prev_close",         Float),
    Column("day_change",         Float),
    Column("day_change_pct",     Float),
    Column("high_52w",           Float),
    Column("low_52w",            Float),
    Column("volume",             Integer),
    # position
    Column("avg_price",          Float),
    Column("lots",               Integer),
    Column("unrealized_pnl",     Float),
    Column("unrealized_pnl_pct", Float),
    Column("total_pnl",          Float),
    Column("position_status",    String(30)),
    Column("dist_from_high",     Float),
    Column("dist_from_low",      Float),
    # fundamentals
    Column("pe",                 Float),
    Column("pb",                 Float),
    Column("roe_pct",            Float),
    Column("div_yield_pct",      Float),
    Column("profit_margin_pct",  Float),
    Column("debt_to_equity",     Float),
    Column("beta",               Float),
    Column("eps",                Float),
    Column("market_cap_raw",     Float),
    Column("revenue_raw",        Float),
)

# LLM analysis output — one row per ticker per run
llm_analyses = Table(
    "llm_analyses", metadata,
    Column("id",              Integer, primary_key=True, autoincrement=True),
    Column("snapshot_id",     Integer, nullable=False),   # FK to stock_snapshots.id
    Column("analysed_at",     DateTime, nullable=False, index=True),
    Column("ticker",          String(10), nullable=False, index=True),
    Column("model",           String(50)),
    Column("recommendation",  String(30)),  # extracted action: HOLD/BUY/AVERAGE DOWN/etc.
    Column("raw_output",      Text),        # Ollama raw response
    Column("clean_html",      Text),        # cleaned Telegram HTML
    Column("sent_telegram",   Integer, default=0),   # 0/1 bool
    Column("skipped_same",    Integer, default=0),   # 1 if skipped because same as previous
)

# Portfolio positions (source of truth — mirrors portfolio.json)
portfolio_positions = Table(
    "portfolio_positions", metadata,
    Column("id",        Integer, primary_key=True, autoincrement=True),
    Column("ticker",    String(10), nullable=False),
    Column("avg_price", Float, nullable=False),
    Column("lots",      Integer, default=0),
    Column("active",    Integer, default=1),   # 0/1 bool
    Column("notes",     Text, default=""),
    Column("updated_at",DateTime, nullable=False),
    UniqueConstraint("ticker", name="uq_portfolio_ticker"),
)


def init_db():
    """Create all tables if they don't exist."""
    metadata.create_all(engine)
    print(f"  💾 DB ready: {DATABASE_URL}")


def upsert_portfolio(positions: list[dict]):
    """
    Sync portfolio.json → portfolio_positions table.
    Inserts new tickers, updates existing ones.
    """
    with engine.begin() as conn:
        for pos in positions:
            existing = conn.execute(
                portfolio_positions.select().where(
                    portfolio_positions.c.ticker == pos["ticker"].upper()
                )
            ).fetchone()

            now = datetime.now(timezone.utc)
            if existing:
                conn.execute(
                    portfolio_positions.update()
                    .where(portfolio_positions.c.ticker == pos["ticker"].upper())
                    .values(
                        avg_price  = pos["avg_price"],
                        lots       = pos.get("lots", 0),
                        active     = 1 if pos.get("active", True) else 0,
                        notes      = pos.get("notes", ""),
                        updated_at = now,
                    )
                )
            else:
                conn.execute(
                    portfolio_positions.insert().values(
                        ticker     = pos["ticker"].upper(),
                        avg_price  = pos["avg_price"],
                        lots       = pos.get("lots", 0),
                        active     = 1 if pos.get("active", True) else 0,
                        notes      = pos.get("notes", ""),
                        updated_at = now,
                    )
                )


def save_snapshot(data: dict) -> int:
    """
    Insert a market snapshot row.
    Returns the new row id (used to link llm_analyses).
    """
    with engine.begin() as conn:
        result = conn.execute(
            stock_snapshots.insert().values(
                fetched_at         = datetime.now(timezone.utc),
                ticker             = data.get("ticker"),
                symbol             = data.get("symbol"),
                name               = data.get("name"),
                sector             = data.get("sector"),
                industry           = data.get("industry"),
                current_price      = data.get("current_price"),
                prev_close         = data.get("prev_close"),
                day_change         = data.get("day_change"),
                day_change_pct     = data.get("day_change_pct"),
                high_52w           = data.get("high_52w"),
                low_52w            = data.get("low_52w"),
                volume             = data.get("volume"),
                avg_price          = data.get("avg_price"),
                lots               = data.get("lots"),
                unrealized_pnl     = data.get("unrealized_pnl"),
                unrealized_pnl_pct = data.get("unrealized_pnl_pct"),
                total_pnl          = data.get("total_pnl"),
                position_status    = data.get("position_status"),
                dist_from_high     = data.get("dist_from_high"),
                dist_from_low      = data.get("dist_from_low"),
                pe                 = data.get("pe"),
                pb                 = data.get("pb"),
                roe_pct            = data.get("roe_pct"),
                div_yield_pct      = data.get("div_yield_pct"),
                profit_margin_pct  = data.get("profit_margin_pct"),
                debt_to_equity     = data.get("debt_to_equity"),
                beta               = data.get("beta"),
                eps                = data.get("eps"),
                market_cap_raw     = data.get("market_cap_raw"),
                revenue_raw        = data.get("revenue_raw"),
            )
        )
        return result.inserted_primary_key[0]


def save_analysis(snapshot_id: int, ticker: str, model: str,
                  raw_output: str, clean_html: str,
                  recommendation: str = "",
                  sent: bool = False,
                  skipped_same: bool = False) -> int:
    """Insert an LLM analysis row linked to a snapshot."""
    with engine.begin() as conn:
        result = conn.execute(
            llm_analyses.insert().values(
                snapshot_id    = snapshot_id,
                analysed_at    = datetime.now(timezone.utc),
                ticker         = ticker.upper(),
                model          = model,
                recommendation = recommendation.upper().strip(),
                raw_output     = raw_output,
                clean_html     = clean_html,
                sent_telegram  = 1 if sent else 0,
                skipped_same   = 1 if skipped_same else 0,
            )
        )
        return result.inserted_primary_key[0]


def get_latest_analysis(ticker: str) -> dict | None:
    """Fetch the most recent analysis for a ticker."""
    with engine.connect() as conn:
        row = conn.execute(
            llm_analyses.select()
            .where(llm_analyses.c.ticker == ticker.upper())
            .order_by(llm_analyses.c.analysed_at.desc())
            .limit(1)
        ).fetchone()
        return dict(row._mapping) if row else None


def get_latest_snapshot(ticker: str) -> dict | None:
    """Fetch the most recent snapshot for a ticker."""
    with engine.connect() as conn:
        row = conn.execute(
            stock_snapshots.select()
            .where(stock_snapshots.c.ticker == ticker.upper())
            .order_by(stock_snapshots.c.fetched_at.desc())
            .limit(1)
        ).fetchone()
        return dict(row._mapping) if row else None


def get_snapshots(ticker: str, limit: int = 10) -> list[dict]:
    """Fetch recent snapshots for a ticker — useful for trend review."""
    with engine.connect() as conn:
        rows = conn.execute(
            stock_snapshots.select()
            .where(stock_snapshots.c.ticker == ticker.upper())
            .order_by(stock_snapshots.c.fetched_at.desc())
            .limit(limit)
        ).fetchall()
        return [dict(r._mapping) for r in rows]


def get_all_positions() -> list[dict]:
    """Get all active portfolio positions."""
    with engine.connect() as conn:
        rows = conn.execute(
            portfolio_positions.select()
            .where(portfolio_positions.c.active == 1)
            .order_by(portfolio_positions.c.ticker)
        ).fetchall()
        return [dict(r._mapping) for r in rows]


def upsert_position(ticker: str, avg_price: float, lots: int, notes: str = ""):
    """Insert or update a single portfolio position."""
    with engine.begin() as conn:
        existing = conn.execute(
            portfolio_positions.select().where(
                portfolio_positions.c.ticker == ticker.upper()
            )
        ).fetchone()
        now = datetime.now(timezone.utc)
        if existing:
            conn.execute(
                portfolio_positions.update()
                .where(portfolio_positions.c.ticker == ticker.upper())
                .values(avg_price=avg_price, lots=lots, active=1,
                        notes=notes, updated_at=now)
            )
        else:
            conn.execute(
                portfolio_positions.insert().values(
                    ticker=ticker.upper(), avg_price=avg_price,
                    lots=lots, active=1, notes=notes, updated_at=now,
                )
            )


def deactivate_position(ticker: str):
    """Set active=0 for a position."""
    with engine.begin() as conn:
        conn.execute(
            portfolio_positions.update()
            .where(portfolio_positions.c.ticker == ticker.upper())
            .values(active=0, updated_at=datetime.now(timezone.utc))
        )


def get_all_latest_snapshots() -> list[dict]:
    """Get the most recent snapshot for each ticker."""
    from sqlalchemy import func, select
    with engine.connect() as conn:
        sub = (
            select(
                stock_snapshots.c.ticker,
                func.max(stock_snapshots.c.id).label("max_id")
            )
            .group_by(stock_snapshots.c.ticker)
            .subquery()
        )
        rows = conn.execute(
            stock_snapshots.select().where(
                stock_snapshots.c.id == sub.c.max_id
            )
        ).fetchall()
        return [dict(r._mapping) for r in rows]


def get_analyses(ticker: str, limit: int = 20) -> list[dict]:
    """Get recent analyses for a ticker, newest first."""
    with engine.connect() as conn:
        rows = conn.execute(
            llm_analyses.select()
            .where(llm_analyses.c.ticker == ticker.upper())
            .order_by(llm_analyses.c.analysed_at.desc())
            .limit(limit)
        ).fetchall()
        return [dict(r._mapping) for r in rows]


def sync_portfolio_json(path: str):
    """Write active DB positions back to portfolio.json."""
    positions = get_all_positions()
    data = {
        "_comment": "Auto-synced from database.",
        "positions": [
            {
                "ticker": p["ticker"],
                "avg_price": p["avg_price"],
                "lots": p["lots"],
                "active": True,
                "notes": p.get("notes", ""),
            }
            for p in positions
        ],
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)