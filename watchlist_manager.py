#!/usr/bin/env python3
"""
watchlist_manager.py
────────────────────
Manages the watchlist.json file and generates AI stock suggestions
based on current portfolio composition and market context.

Usage:
  python watchlist_manager.py add TLKM "Defensive telco"
  python watchlist_manager.py remove TLKM
  python watchlist_manager.py suggest          # AI generates suggestions
  python watchlist_manager.py list             # Print current watchlist
"""

import argparse
import json
import logging
import os
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")

BASE_DIR       = Path(__file__).parent
WATCHLIST_FILE = BASE_DIR / "watchlist.json"
PORTFOLIO_FILE = BASE_DIR / "portfolio.json"


# ── I/O helpers ──────────────────────────────────────────────────────────────
def load_watchlist() -> dict:
    """Load watchlist from JSON file."""
    if not WATCHLIST_FILE.exists():
        return {"user": [], "ai_suggested": []}
    return json.loads(WATCHLIST_FILE.read_text())


def save_watchlist(data: dict) -> None:
    """Save watchlist to JSON file."""
    WATCHLIST_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def load_portfolio_tickers() -> list[str]:
    """Return list of active ticker codes from portfolio.json."""
    if not PORTFOLIO_FILE.exists():
        return []
    raw = json.loads(PORTFOLIO_FILE.read_text())
    positions = raw.get("positions", [])
    return [p["ticker"].upper() for p in positions if p.get("active", True)]


def all_watchlist_tickers(wl: dict) -> list[str]:
    """All tickers currently in watchlist regardless of source."""
    return (
        [e["ticker"].upper() for e in wl.get("user", [])]
        + [e["ticker"].upper() for e in wl.get("ai_suggested", [])]
    )


# ── CRUD ─────────────────────────────────────────────────────────────────────
def cmd_add(ticker: str, notes: str = "") -> None:
    """Add a ticker to user watchlist."""
    ticker = ticker.upper()
    wl = load_watchlist()
    portfolio = load_portfolio_tickers()

    if ticker in portfolio:
        log.error(f"{ticker} is already in portfolio — watchlist must be mutually exclusive")
        return

    existing = all_watchlist_tickers(wl)
    if ticker in existing:
        log.warning(f"{ticker} is already in the watchlist")
        return

    wl["user"].append({
        "ticker": ticker,
        "added_at": str(date.today()),
        "notes": notes,
    })
    save_watchlist(wl)
    log.info(f"Added {ticker} to user watchlist")


def cmd_remove(ticker: str) -> None:
    """Remove a ticker from watchlist (any source)."""
    ticker = ticker.upper()
    wl = load_watchlist()
    before_user = len(wl["user"])
    before_ai = len(wl["ai_suggested"])

    wl["user"] = [e for e in wl["user"] if e["ticker"].upper() != ticker]
    wl["ai_suggested"] = [e for e in wl["ai_suggested"] if e["ticker"].upper() != ticker]

    if len(wl["user"]) == before_user and len(wl["ai_suggested"]) == before_ai:
        log.warning(f"{ticker} not found in watchlist")
    else:
        save_watchlist(wl)
        log.info(f"Removed {ticker} from watchlist")


def cmd_list() -> None:
    """Print current watchlist."""
    wl = load_watchlist()
    print("\n WATCHLIST\n" + "-" * 40)
    print("User-added:")
    for e in wl["user"]:
        print(f"  {e['ticker']:8s}  {e.get('notes', '')}")
    print("\nAI-suggested:")
    for e in wl["ai_suggested"]:
        rationale = e.get("rationale", "")[:80]
        print(f"  {e['ticker']:8s}  {rationale}")
    print()


# ── AI Suggestion ────────────────────────────────────────────────────────────
def _call_ollama(prompt: str) -> str:
    """Call Ollama API and return response text."""
    resp = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 1024},
            "messages": [
                {"role": "system", "content": "You are an Indonesian stock market analyst."},
                {"role": "user", "content": prompt},
            ],
        },
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    return (data.get("message") or {}).get("content", "") or data.get("response", "")


def cmd_suggest(max_suggestions: int = 5) -> None:
    """Ask Ollama to recommend IDX stocks complementary to current portfolio."""
    wl = load_watchlist()
    portfolio = load_portfolio_tickers()
    existing = all_watchlist_tickers(wl)
    exclude = set(portfolio + existing)

    # Build portfolio context
    if not PORTFOLIO_FILE.exists():
        log.error("portfolio.json not found")
        return

    raw = json.loads(PORTFOLIO_FILE.read_text())
    positions = raw.get("positions", [])
    portfolio_summary = "\n".join(
        f"  - {p['ticker']}: {p.get('notes', '')}"
        for p in positions
        if p.get("active", True)
    )

    exclude_str = ", ".join(sorted(exclude)) if exclude else "none"

    prompt = f"""Current portfolio:
{portfolio_summary}

Tickers to EXCLUDE (already held or already watchlisted):
{exclude_str}

Task: Suggest exactly {max_suggestions} IDX-listed stocks that:
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

    log.info(f"Asking {OLLAMA_MODEL} for {max_suggestions} stock suggestions...")
    raw_response = _call_ollama(prompt)

    # Parse JSON from response
    try:
        clean = raw_response.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        suggestions = json.loads(clean.strip())
    except json.JSONDecodeError:
        log.error(f"Failed to parse AI response as JSON:\n{raw_response}")
        return

    # Filter out any that slipped through the exclude set
    filtered = [
        s for s in suggestions
        if isinstance(s, dict) and s.get("ticker", "").upper() not in exclude
    ]

    # Build new ai_suggested entries
    today = str(date.today())
    new_entries = []
    for s in filtered[:max_suggestions]:
        new_entries.append({
            "ticker": s["ticker"].upper(),
            "sector": s.get("sector", ""),
            "rationale": s.get("rationale", ""),
            "added_at": today,
            "source": "ai",
        })

    # Replace ai_suggested (re-run always refreshes)
    wl["ai_suggested"] = new_entries
    save_watchlist(wl)

    log.info(f"AI suggested {len(new_entries)} stocks:")
    for e in new_entries:
        log.info(f"  {e['ticker']:8s} [{e['sector']}]  {e['rationale']}")


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Watchlist manager for IDX Portfolio Analyzer")
    sub = parser.add_subparsers(dest="cmd")

    p_add = sub.add_parser("add", help="Add a ticker to user watchlist")
    p_add.add_argument("ticker")
    p_add.add_argument("notes", nargs="?", default="")

    p_rm = sub.add_parser("remove", help="Remove a ticker from watchlist")
    p_rm.add_argument("ticker")

    sub.add_parser("list", help="Show current watchlist")

    p_suggest = sub.add_parser("suggest", help="AI-generate stock suggestions")
    p_suggest.add_argument("--count", type=int, default=5, help="Number of suggestions")

    args = parser.parse_args()

    if args.cmd == "add":
        cmd_add(args.ticker, args.notes)
    elif args.cmd == "remove":
        cmd_remove(args.ticker)
    elif args.cmd == "list":
        cmd_list()
    elif args.cmd == "suggest":
        cmd_suggest(args.count)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
