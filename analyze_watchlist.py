#!/usr/bin/env python3
"""
analyze_watchlist.py
────────────────────
Analyzes every ticker in watchlist.json (both user and ai_suggested)
using the same fetch + Ollama pipeline as the main portfolio analyzer.

Produces a BUY SEKARANG / TUNGGU / HINDARI verdict per ticker and sends to Telegram.

Usage:
  python analyze_watchlist.py                  # Full watchlist
  python analyze_watchlist.py --no-telegram    # Print only
  python analyze_watchlist.py --source user    # User tickers only
  python analyze_watchlist.py --source ai      # AI-suggested only
"""

import argparse
import json
import logging
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

from db import init_db, save_snapshot, save_analysis, get_latest_analysis
from fetch_portfolio import fetch_stock, clean_for_telegram, call_ollama
from utils import (
    fmt_idr, fmt_cap, safe_float, normalize_ticker,
    now_wib, get_version, get_version_url,
)

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
SEND_TELEGRAM    = os.getenv("SEND_TELEGRAM", "true").lower() == "true"

BASE_DIR       = Path(__file__).parent
WATCHLIST_FILE = BASE_DIR / "watchlist.json"


# ── Telegram (reuse pattern from fetch_portfolio) ────────────────────────────
def send_telegram(text: str) -> None:
    """Send message to Telegram with chunking support."""
    if not SEND_TELEGRAM or not TELEGRAM_TOKEN:
        log.info("📵 Telegram disabled — printing instead:")
        print(text)
        print()
        return

    LIMIT = 4000
    chunks = [text] if len(text) <= LIMIT else _chunk_text(text, LIMIT)
    total = len(chunks)
    for i, chunk in enumerate(chunks):
        msg = chunk if total == 1 else f"{chunk}\n\n<i>({i+1}/{total})</i>"
        _send_request(msg)
        if i < total - 1:
            time.sleep(0.5)


def _chunk_text(text: str, limit: int) -> list[str]:
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = current + ("\n\n" if current else "") + para
        if len(candidate) > limit:
            if current:
                chunks.append(current.strip())
            current = para
        else:
            current = candidate
    if current:
        chunks.append(current.strip())
    return chunks


def _send_request(text: str, max_retries: int = 3) -> bool:
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
                timeout=15,
            )
            if resp.status_code == 200:
                return True
            if resp.status_code == 429:
                time.sleep(min(2 ** attempt, 10))
                continue
            log.warning(f"Telegram {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log.error(f"Telegram error: {e}")
        if attempt < max_retries - 1:
            time.sleep(2 ** attempt)
    return False


# ── Prompt builder for watchlist analysis ────────────────────────────────────
def build_watchlist_prompt(data: dict, rationale: str = "", source: str = "user") -> str:
    """Build Indonesian-language prompt for watchlist stock analysis."""
    ticker = data["ticker"]
    price = data.get("current_price")
    pe = data.get("pe")
    pb = data.get("pb")
    roe = data.get("roe_pct")
    div_yield = data.get("div_yield_pct")
    name = data.get("name", ticker)
    high52 = data.get("high_52w")
    low52 = data.get("low_52w")
    volume = data.get("volume")

    dist_high = data.get("dist_from_high")
    dist_low = data.get("dist_from_low")

    source_note = (
        f"AI-suggested for watchlist (reason: {rationale})"
        if source == "ai"
        else "User-added to watchlist"
    )

    price_str = fmt_idr(price) if price else "N/A"

    return f"""Kamu adalah analis saham IDX senior. Ini adalah saham WATCHLIST (belum dimiliki), bukan portofolio aktif.

Saham    : {ticker} ({name})
Sumber   : {source_note}
Harga    : {price_str}
Volume   : {f"{volume:,}" if volume else "N/A"}
52W High : {fmt_idr(high52)} (jarak: {dist_high}%)
52W Low  : {fmt_idr(low52)} (jarak: {dist_low}%)
PER      : {pe}x
PBV      : {pb}x
ROE      : {roe}%
Div Yield: {div_yield}%

Berikan analisis singkat dalam format berikut:
1. **Kondisi Teknikal** (2-3 kalimat: tren harga, posisi vs 52W range)
2. **Fundamental Snapshot** (1-2 kalimat: valuasi, ROE, yield)
3. **Katalis & Risiko** (1-2 kalimat tiap sisi)
4. **VERDICT: [BUY SEKARANG / TUNGGU / HINDARI]** — satu pilihan saja, dengan alasan singkat satu kalimat.

Kriteria:
- BUY SEKARANG: fundamental kuat, valuasi wajar/murah, momentum bagus
- TUNGGU: fundamental oke tapi belum breakout atau masih sideways
- HINDARI: overbought, fundamental lemah, atau risiko tinggi

INSTRUKSI FORMAT:
Tulis HANYA dalam HTML Telegram. Gunakan HANYA tag: <b>, <i>, <code>.
JANGAN gunakan Markdown (**, ##, -, *). JANGAN tulis ```html atau ```.
Maksimal 150 kata. Langsung ke poin. Tidak perlu disclaimer panjang.
"""


def extract_watchlist_verdict(text: str) -> str:
    """Extract verdict keyword from watchlist analysis output."""
    upper = text.upper()
    for kw in ["BUY SEKARANG", "TUNGGU", "HINDARI"]:
        if kw in upper:
            return kw
    return "UNKNOWN"


# ── Main analysis loop ────────────────────────────────────────────────────────
def analyze_watchlist(source_filter: str = "all") -> None:
    if not WATCHLIST_FILE.exists():
        log.error("watchlist.json not found")
        return

    wl = json.loads(WATCHLIST_FILE.read_text())

    entries: list[dict] = []
    if source_filter in ("all", "user"):
        for e in wl.get("user", []):
            entries.append({**e, "source": "user"})
    if source_filter in ("all", "ai"):
        for e in wl.get("ai_suggested", []):
            entries.append({**e, "source": "ai"})

    if not entries:
        log.warning("Watchlist is empty")
        return

    init_db()

    now_str = now_wib().strftime("%A, %d %B %Y %H:%M WIB")
    header = (
        f"<b>👀 Watchlist Analysis</b>\n"
        f"<i>{now_str}</i>\n\n"
        f"Menganalisis {len(entries)} saham watchlist...\n"
        f"<i><a href=\"{get_version_url()}\">v{get_version()}</a></i>"
    )
    send_telegram(header)
    time.sleep(1)

    for i, entry in enumerate(entries, 1):
        ticker = entry["ticker"].upper()
        source = entry.get("source", "user")
        rationale = entry.get("rationale", entry.get("notes", ""))
        source_label = "👤 User" if source == "user" else "🤖 AI"

        log.info(f"[{i}/{len(entries)}] {ticker} ({source_label})")

        data = fetch_stock(ticker)
        if "error" in data:
            log.warning(f"Skipping {ticker}: {data['error']}")
            send_telegram(f"⚠️ <b>{ticker}</b> — gagal fetch: <code>{data['error'][:200]}</code>")
            continue

        # Save snapshot to DB
        snapshot_id = None
        if not data.get("from_cache"):
            snapshot_id = save_snapshot(data)

        prompt = build_watchlist_prompt(data, rationale=rationale, source=source)
        raw_llm = call_ollama(prompt)
        clean = clean_for_telegram(raw_llm)
        verdict = extract_watchlist_verdict(clean)

        verdict_emoji = {"BUY SEKARANG": "🟢", "TUNGGU": "🟡", "HINDARI": "🔴"}.get(verdict, "❓")
        price_str = fmt_idr(data["current_price"]) if data.get("current_price") else "N/A"

        msg = (
            f"<b>{'👤' if source == 'user' else '🤖'} [{ticker}] {data.get('name', ticker)}</b>\n"
            f"Harga: <code>{price_str}</code> | {verdict_emoji} {verdict}\n\n"
            f"{clean}"
        )
        send_telegram(msg)

        # Save analysis to DB
        if snapshot_id:
            save_analysis(
                snapshot_id, ticker, OLLAMA_MODEL,
                raw_llm, clean,
                recommendation=verdict,
                sent=SEND_TELEGRAM,
            )

        if i < len(entries):
            time.sleep(3)

    log.info("Watchlist analysis done")


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze watchlist stocks")
    parser.add_argument("--no-telegram", action="store_true", help="Print instead of Telegram")
    parser.add_argument(
        "--source", choices=["all", "user", "ai"], default="all",
        help="Filter by source (default: all)",
    )
    args = parser.parse_args()

    global SEND_TELEGRAM
    if args.no_telegram:
        SEND_TELEGRAM = False

    analyze_watchlist(source_filter=args.source)


if __name__ == "__main__":
    main()
