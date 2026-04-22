"""
watchlist.py — Shared watchlist business logic.
All functions return {ok: bool, message: str} and never raise.
"""

import json
import logging
import os
import re
import requests
from datetime import date
from pathlib import Path

from app.utils import write_json_atomic, validate_watchlist_json
from app.db import get_all_positions

log = logging.getLogger(__name__)

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")

_BASE = Path(__file__).parent.parent
WATCHLIST_FILE = str(
    Path(os.getenv("WATCHLIST_FILE", str(_BASE / "data" / "json" / "watchlist.json")))
)
PORTFOLIO_FILE = str(
    Path(os.getenv("PORTFOLIO_FILE", str(_BASE / "data" / "json" / "portfolio.json")))
)

TICKER_RE = re.compile(r"^[A-Z0-9]{1,10}$")


# ── I/O ───────────────────────────────────────────────────────────────────────

def load_watchlist() -> dict:
    path = Path(WATCHLIST_FILE)
    if not path.exists():
        return {"user": [], "ai_suggested": []}
    try:
        data = json.loads(path.read_text())
    except Exception as e:
        log.error(f"Failed to read watchlist.json: {e}")
        return {"user": [], "ai_suggested": []}
    if not validate_watchlist_json(data):
        log.error("Invalid watchlist.json schema — returning empty")
        return {"user": [], "ai_suggested": []}
    return data


def save_watchlist(data: dict) -> None:
    write_json_atomic(WATCHLIST_FILE, data)


def all_tickers(wl: dict) -> list[str]:
    return (
        [e["ticker"].upper() for e in wl.get("user", [])]
        + [e["ticker"].upper() for e in wl.get("ai_suggested", [])]
    )


def _portfolio_tickers() -> list[str]:
    try:
        return [p["ticker"].upper() for p in get_all_positions()]
    except Exception:
        return []


# ── CRUD ──────────────────────────────────────────────────────────────────────

def add_ticker(ticker: str, notes: str = "") -> dict:
    ticker = ticker.upper().strip()
    if not TICKER_RE.match(ticker):
        return {"ok": False, "message": f"Ticker tidak valid: {ticker}"}

    portfolio = _portfolio_tickers()
    if ticker in portfolio:
        return {"ok": False, "message": f"{ticker} sudah ada di portfolio."}

    wl = load_watchlist()
    if ticker in all_tickers(wl):
        return {"ok": False, "message": f"{ticker} sudah ada di watchlist."}

    wl["user"].append({
        "ticker": ticker,
        "added_at": str(date.today()),
        "notes": notes,
    })
    save_watchlist(wl)
    return {"ok": True, "message": f"{ticker} ditambahkan ke watchlist."}


def remove_ticker(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    wl = load_watchlist()
    before = len(wl["user"]) + len(wl["ai_suggested"])
    wl["user"]         = [e for e in wl["user"]         if e["ticker"].upper() != ticker]
    wl["ai_suggested"] = [e for e in wl["ai_suggested"] if e["ticker"].upper() != ticker]
    after = len(wl["user"]) + len(wl["ai_suggested"])
    if before == after:
        return {"ok": False, "message": f"{ticker} tidak ditemukan di watchlist."}
    save_watchlist(wl)
    return {"ok": True, "message": f"{ticker} dihapus dari watchlist."}


# ── AI Suggest ────────────────────────────────────────────────────────────────

def _call_ollama(prompt: str) -> str:
    resp = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 1024},
            "messages": [
                {"role": "system", "content": "You are an Indonesian stock market analyst."},
                {"role": "user",   "content": prompt},
            ],
        },
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    return (data.get("message") or {}).get("content", "") or data.get("response", "")


def suggest(count: int = 5) -> dict:
    count = max(1, min(count, 10))
    wl        = load_watchlist()
    portfolio = _portfolio_tickers()
    exclude   = set(portfolio + all_tickers(wl))

    try:
        port_raw  = json.loads(Path(PORTFOLIO_FILE).read_text())
        positions = port_raw.get("positions", [])
    except Exception:
        positions = []

    portfolio_summary = "\n".join(
        f"  - {p['ticker']}: {p.get('notes', '')}"
        for p in positions if p.get("active", True)
    ) or "  (kosong)"

    exclude_str = ", ".join(sorted(exclude)) if exclude else "none"

    prompt = f"""Current portfolio:
{portfolio_summary}

Tickers to EXCLUDE (already held or watchlisted):
{exclude_str}

Task: Suggest exactly {count} IDX-listed stocks that:
1. Are NOT in the exclude list above
2. Complement or diversify the existing portfolio
3. Are reasonably liquid (top 100 IDX by market cap preferred)
4. Are suitable for medium-term holding (3-12 months)

Format your response as valid JSON only, no explanation outside the JSON:
[
  {{"ticker": "XXXX", "sector": "...", "rationale": "...one sentence max..."}},
  ...
]

Only output the JSON array. No preamble, no markdown fences."""

    try:
        raw = _call_ollama(prompt)
    except Exception as e:
        log.error(f"Ollama request failed: {e}")
        return {"ok": False, "message": "Gagal menghubungi Ollama.", "suggestions": []}

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        parsed = json.loads(clean.strip())
    except json.JSONDecodeError:
        log.error(f"Failed to parse Ollama response: {raw[:200]}")
        return {"ok": False, "message": "AI mengembalikan format tidak valid.", "suggestions": []}

    today = str(date.today())
    new_entries = [
        {
            "ticker":    s["ticker"].upper(),
            "sector":    s.get("sector", ""),
            "rationale": s.get("rationale", ""),
            "added_at":  today,
            "source":    "ai",
        }
        for s in parsed
        if isinstance(s, dict) and s.get("ticker", "").upper() not in exclude
    ][:count]

    wl["ai_suggested"] = new_entries
    save_watchlist(wl)

    return {
        "ok":          True,
        "message":     f"AI menyarankan {len(new_entries)} saham.",
        "suggestions": new_entries,
    }
