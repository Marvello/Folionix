#!/usr/bin/env python3
"""
IDX Portfolio Analyzer
----------------------
Fetches data from Yahoo Finance via yfinance, analyzes each position
with a local Ollama model, and sends results to Telegram.

Usage:
    python fetch_portfolio.py                  # full portfolio
    python fetch_portfolio.py BBCA             # single ticker
    python fetch_portfolio.py BBCA BBRI BMRI   # multiple tickers

Requirements:
    pip install yfinance requests python-dotenv
"""

import sys
import json
import os
import time
import random
import argparse
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import yfinance as yf
import requests
from dotenv import load_dotenv
from app.db import init_db, upsert_portfolio, save_snapshot, save_analysis, get_latest_snapshot, get_latest_analysis, get_snapshots
from app.utils import (safe_float, fmt_idr, fmt_cap, sign, normalize_ticker,
                       WIB, now_wib, fmt_wib, get_version, get_version_url,
                       validate_portfolio_json, color_pnl)

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# CONFIG — edit .env to change these
# ──────────────────────────────────────────────
OLLAMA_URL       = os.getenv("OLLAMA_URL",      "http://localhost:11434")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL",    "qwen2.5:7b")
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN",  "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
SEND_TELEGRAM    = os.getenv("SEND_TELEGRAM",   "true").lower() == "true"
PORTFOLIO_FILE   = os.getenv("PORTFOLIO_FILE",  "data/json/portfolio.json")
CACHE_MINUTES    = int(os.getenv("CACHE_MINUTES", "30"))


# ──────────────────────────────────────────────
# LOAD PORTFOLIO FROM JSON
# ──────────────────────────────────────────────
def load_portfolio() -> dict:
    """Load positions from portfolio.json. Returns {TICKER: {avg_price, lots, notes}}."""
    # Resolve relative to project root (parent of app/)
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), PORTFOLIO_FILE)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Portfolio file not found: {path}")
    with open(path) as f:
        data = json.load(f)
    if not validate_portfolio_json(data):
        raise ValueError(f"Invalid portfolio.json schema: {path}")
    return {
        p["ticker"].upper(): {
            "avg_price": p["avg_price"],
            "lots":      p.get("lots", 0),
            "notes":     p.get("notes", ""),
            "active":    p.get("active", True),
        }
        for p in data["positions"]
        if p.get("active", True)
    }


# ──────────────────────────────────────────────
# STEP 1 — FETCH DATA
# ──────────────────────────────────────────────
def fetch_stock(ticker: str, avg_price: Optional[float] = None,
                lots: int = 0, notes: str = "") -> dict:
    """
    Fetch price + fundamentals via yfinance with retry + backoff.
    Uses fast_info first (lighter), then info with up to 3 retries.
    """
    symbol = normalize_ticker(ticker)
    log.info(f"📡 Fetching {symbol}...")

    # ── Cache check ──
    cached = get_latest_snapshot(ticker)
    if cached:
        fetched = cached["fetched_at"]
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - fetched).total_seconds() / 60
        if age < CACHE_MINUTES:
            log.info(f"✓ Using cached data ({age:.0f}m ago)")
            # Always re-read lots + avg_price from portfolio.json (not from snapshot)
            # so changes to portfolio.json take effect immediately without cache bust
            current_price   = cached.get("current_price")
            avg_price_live  = avg_price or cached.get("avg_price")
            lots_live       = lots
            pnl_live        = round(current_price - avg_price_live, 0) if (current_price and avg_price_live) else None
            pnl_pct_live    = round((pnl_live / avg_price_live) * 100, 2) if (pnl_live and avg_price_live) else None
            total_pnl_live  = round(pnl_live * lots_live * 100, 0) if (pnl_live and lots_live) else None

            cached["lots"]               = lots_live
            cached["avg_price"]          = avg_price_live
            cached["unrealized_pnl"]     = pnl_live
            cached["unrealized_pnl_pct"] = pnl_pct_live
            cached["total_pnl"]          = total_pnl_live
            cached["notes"]              = notes
            cached["pnl_arrow"]  = "📈" if (pnl_pct_live or 0) > 0 else ("📉" if (pnl_pct_live or 0) < 0 else "➡️")
            cached["day_arrow"]  = "▲" if (cached.get("day_change_pct") or 0) > 0 else ("▼" if (cached.get("day_change_pct") or 0) < 0 else "─")
            cached["market_cap"] = fmt_cap(cached.get("market_cap_raw"))
            cached["revenue"]    = fmt_cap(cached.get("revenue_raw"))
            cached["fetched_at_display"] = fmt_wib(cached["fetched_at"])
            cached["from_cache"] = True
            return cached

    info = {}
    fi   = None
    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            stock = yf.Ticker(symbol)
            try:
                fi = stock.fast_info
            except Exception:
                fi = None  # fast_info unavailable (delisted/invalid)
            info  = stock.info or {}
            break
        except Exception as e:
            err_str = str(e)
            is_rate_limit = any(x in err_str for x in ["429", "Too Many Requests", "Rate limited"])
            if is_rate_limit and attempt < MAX_RETRIES - 1:
                wait = 5 * (2 ** attempt)   # 5s → 10s → 20s
                log.warning(f"⏳ Rate limited. Waiting {wait}s (attempt {attempt+1}/{MAX_RETRIES})...")
                time.sleep(wait)
            else:
                log.error(f"Failed to fetch {ticker}: {e}")
                return {"ticker": ticker, "error": str(e)}

    # ── Price ──
    current = safe_float(
        info.get("currentPrice") or info.get("regularMarketPrice")
        or (fi.last_price if fi else None), 0
    )
    prev = safe_float(
        info.get("regularMarketPreviousClose")
        or (fi.previous_close if fi else None), 0
    )
    day_chg     = round(current - prev, 0) if (current and prev) else None
    day_chg_pct = round((day_chg / prev) * 100, 2) if (day_chg and prev) else None
    high52 = safe_float(info.get("fiftyTwoWeekHigh") or (fi.fifty_two_week_high if fi else None), 0)
    low52  = safe_float(info.get("fiftyTwoWeekLow")  or (fi.fifty_two_week_low if fi else None),  0)
    volume = safe_float(info.get("regularMarketVolume") or (fi.last_volume if fi else None), 0)

    # ── P&L vs avg buy price ──
    pnl = pnl_pct = total_pnl = None
    position_status = "N/A"
    if current and avg_price:
        pnl       = round(current - avg_price, 0)           # per share
        pnl_pct   = round((pnl / avg_price) * 100, 2)
        total_pnl = round(pnl * lots * 100, 0)              # lots × 100 shares/lot
        if   pnl_pct >=  10: position_status = "🟢 BIG PROFIT"
        elif pnl_pct >=   2: position_status = "🟢 PROFIT"
        elif pnl_pct >=  -2: position_status = "⚪ BREAKEVEN"
        elif pnl_pct >= -10: position_status = "🟡 SMALL LOSS"
        elif pnl_pct >= -20: position_status = "🔴 LOSS"
        else:                position_status = "🔴 DEEP LOSS"

    dist_high = round((current/high52 - 1)*100, 1) if (current and high52) else None
    dist_low  = round((current/low52  - 1)*100, 1) if (current and low52)  else None

    # ── Fundamentals ──
    pe  = safe_float(info.get("trailingPE"))
    pb  = safe_float(info.get("priceToBook"))
    roe = round(float(info["returnOnEquity"])  * 100, 2) if info.get("returnOnEquity")  else None
    dY  = round(float(info["dividendYield"])   * 100, 2) if info.get("dividendYield")   else None
    pm  = round(float(info["profitMargins"])   * 100, 2) if info.get("profitMargins")   else None
    de  = safe_float(info.get("debtToEquity"))
    beta= safe_float(info.get("beta"))
    eps = safe_float(info.get("trailingEps"))

    day_arrow = "▲" if (day_chg_pct and day_chg_pct > 0) else ("▼" if (day_chg_pct and day_chg_pct < 0) else "─")
    pnl_arrow = "📈" if (pnl_pct and pnl_pct > 0) else ("📉" if (pnl_pct and pnl_pct < 0) else "➡️")

    log.info(f"✓ Fetched {symbol}")
    return {
        "ticker":             ticker.upper(),
        "symbol":             symbol,
        "name":               info.get("longName") or info.get("shortName", symbol),
        "sector":             info.get("sector", "N/A"),
        "industry":           info.get("industry", "N/A"),
        "notes":              notes,
        "lots":               lots,
        # price
        "current_price":      current,
        "prev_close":         prev,
        "day_change":         day_chg,
        "day_change_pct":     day_chg_pct,
        "day_arrow":          day_arrow,
        "high_52w":           high52,
        "low_52w":            low52,
        "volume":             int(volume) if volume else None,
        # position
        "avg_price":          avg_price,
        "unrealized_pnl":     pnl,
        "unrealized_pnl_pct": pnl_pct,
        "total_pnl":          total_pnl,        # pnl × lots × 100 shares
        "position_status":    position_status,
        "pnl_arrow":          pnl_arrow,
        "dist_from_high":     dist_high,
        "dist_from_low":      dist_low,
        # fundamentals
        "pe":                 pe,
        "pb":                 pb,
        "roe_pct":            roe,
        "div_yield_pct":      dY,
        "profit_margin_pct":  pm,
        "debt_to_equity":     de,
        "beta":               beta,
        "eps":                eps,
        "market_cap":         fmt_cap(info.get("marketCap")),
        "revenue":            fmt_cap(info.get("totalRevenue")),
        "market_cap_raw":     safe_float(info.get("marketCap"), 0),
        "revenue_raw":        safe_float(info.get("totalRevenue"), 0),
        # meta
        "fetched_at":         datetime.now(timezone.utc),
        "fetched_at_display": fmt_wib(datetime.now(timezone.utc)),
        "from_cache":         False,
    }


# ──────────────────────────────────────────────
# STEP 2 — BUILD PROMPT
# ──────────────────────────────────────────────
def build_prompt(d: dict, history: list[dict] | None = None) -> str:
    now = now_wib()  # from utils — returns WIB-aware datetime
    hour = now.hour
    minute = now.minute

    # Session context
    if   hour == 9  and minute == 0:  session = "SESSION 1 OPEN (09:00)"
    elif hour == 10:                   session = "SESSION 1 — 10:00 WIB"
    elif hour == 11:                   session = "SESSION 1 — 11:00 WIB (1 hr to close)"
    elif hour == 12:                   session = "SESSION 1 CLOSE (12:00)"
    elif hour == 13:                   session = "SESSION 2 OPEN (13:30)"
    elif hour == 14 and minute >= 30:  session = "SESSION 2 — 14:30 WIB (30 min to close ⚠️)"
    elif hour == 15:                   session = "MARKET CLOSE (15:00)"
    else:                              session = f"PORTFOLIO UPDATE ({hour:02d}:{minute:02d} WIB)"

    ACTION_THRESHOLD = int(os.getenv("ACTION_THRESHOLD_IDR", "1000000"))  # default Rp 1jt
    pnl_block = ""
    if d.get("avg_price") and d.get("current_price"):
        total_pnl    = d.get("total_pnl") or 0
        lots         = d.get("lots", 0)
        total_invest = (d["avg_price"] * lots * 100) if (d.get("avg_price") and lots) else None
        above_thresh = abs(total_pnl) >= ACTION_THRESHOLD
        thresh_note  = (
            f"Total P&L Rp {total_pnl:+,.0f} {'✅ above' if above_thresh else '⚠️ below'} "
            f"action threshold (Rp {ACTION_THRESHOLD:,.0f}). "
            f"{'Consider taking action.' if above_thresh else 'Monitor only — not material yet.'}"
        )
        pnl_block = f"""
INVESTOR POSITION:
- Lots Held             : {lots} lot ({lots*100:,} shares)
- Capital Invested      : {fmt_cap(total_invest) if total_invest else "N/A"}
- Average Buy Price     : Rp {d['avg_price']:,.2f}
- Current Price         : {fmt_idr(d['current_price'])}
- P&L per Share         : {fmt_idr(d['unrealized_pnl'])} ({sign(d['unrealized_pnl_pct'])}{d['unrealized_pnl_pct']}%)
- Total P&L             : Rp {total_pnl:+,.0f}
- Status                : {d['position_status']}
- Action Threshold      : {thresh_note}
- Dist from 52W High    : {d['dist_from_high']}%
- Dist from 52W Low     : {d['dist_from_low']}%"""

    trend_block = ""
    if history and len(history) > 1:
        trend_lines = ["PRICE TREND (newest → oldest):"]
        for snap in history[:5]:
            ts = snap.get("fetched_at")
            if ts:
                ts_str = fmt_wib(ts) if hasattr(ts, 'strftime') else str(ts)
            else:
                ts_str = "N/A"
            price = snap.get("current_price", "N/A")
            day_pct = snap.get("day_change_pct")
            day_str = f"{day_pct:+.2f}%" if day_pct is not None else "N/A"
            trend_lines.append(f"- {ts_str}: Rp {price:,.0f} ({day_str})")
        trend_block = "\n".join(trend_lines)

    return f"""You are an IDX stock analyst helping a retail investor decide BUY/SELL/HOLD in real-time.

=== MARKET SESSION: {session} ===

=== {d['ticker']} — {d['name']} ===
Sector: {d['sector']} | {d['industry']}
Context: {d['notes']}

PRICE:
- Current  : {fmt_idr(d['current_price'])} ({d['day_arrow']} {sign(d['day_change_pct'])}{d['day_change_pct']}%)
- Volume   : {f"{d['volume']:,}" if d.get('volume') else "N/A"} lots
- 52W High : {fmt_idr(d['high_52w'])} | 52W Low: {fmt_idr(d['low_52w'])}
{pnl_block}

FUNDAMENTALS:
- P/E: {d['pe']}x | P/B: {d['pb']}x | Beta: {d['beta']}
- ROE: {d['roe_pct']}% | Profit Margin: {d['profit_margin_pct']}%
- Dividend Yield: {d['div_yield_pct']}% | EPS: {fmt_idr(d['eps'], 2)}
- Debt/Equity: {d['debt_to_equity']} | Market Cap: {d['market_cap']}

{trend_block}

FORMAT INSTRUCTIONS:
Write ONLY in Telegram HTML. Use ONLY tags: <b>, <i>, <code>.
Do NOT use Markdown (**, ##, -, *). Do NOT write ```html or ```.
Maximum 200 words.

REQUIRED FORMAT (fill in the bracketed sections):

<b>{d['ticker']} {d['pnl_arrow']} {d['position_status']}</b>
<i>{d['name']} | {color_pnl(d['day_change_pct'])} {sign(d['day_change_pct'])}{d['day_change_pct']}% | {session}</i>

<b>📍 Your Position</b>
{d.get('lots',0)} lots | Bought: <code>Rp {d['avg_price']:,.2f}</code> → Now: <code>{fmt_idr(d['current_price'])}</code>
P&L/share: {color_pnl(d['unrealized_pnl'])} <code>{fmt_idr(d['unrealized_pnl'])} ({sign(d['unrealized_pnl_pct'])}{d['unrealized_pnl_pct']}%)</code>
Total P&L: {color_pnl(d.get('total_pnl'))} <code>Rp {(d.get('total_pnl') or 0):+,.0f}</code>
[1 sentence position context]

<b>⚡ Recommended Action</b>
[If total P&L below Rp 1,000,000: write MONITOR — not material enough for action]
[If total P&L above Rp 1,000,000: BUY / AVERAGE DOWN / HOLD / TRIM / CUT LOSS — 2-sentence reason + price level]

<b>⚠️ Watch Out</b>
[1 specific risk today]"""


# ──────────────────────────────────────────────
# STEP 3 — CALL OLLAMA
# ──────────────────────────────────────────────
def call_ollama(prompt: str) -> str:
    log.info(f"🤖 Calling Ollama ({OLLAMA_MODEL})...")
    try:
        # Use /api/chat — more reliable for instruction-following models.
        # Split into system + user so the model doesn't consume tokens
        # trying to figure out its role from the prompt body.
        lines = prompt.strip().split("\n")
        # Everything up to the first === block is the system role
        split_idx = next((i for i, l in enumerate(lines) if l.startswith("===")), len(lines))
        system_msg = "\n".join(lines[:split_idx]).strip()
        user_msg   = "\n".join(lines[split_idx:]).strip()

        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model":  OLLAMA_MODEL,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 2048,
                    "num_ctx":     8192,
                },
                "messages": [
                    {"role": "system",  "content": system_msg or "You are a helpful stock analyst."},
                    {"role": "user",    "content": user_msg or prompt},
                ],
            },
            timeout=120,  # gemma4 is slower, give it more time
        )
        resp.raise_for_status()
        data = resp.json()

        # /api/chat returns message.content, not response
        text = (data.get("message") or {}).get("content", "")

        if not text:
            # fallback: try legacy response field just in case
            text = data.get("response", "")

        if not text:
            done_reason = data.get("done_reason", "unknown")
            log.warning(f"Empty Ollama response (done_reason={done_reason})")
            return f"<b>⚠️ Model returned empty response</b>\n<i>done_reason: {done_reason}</i>"

        log.info("✓ Ollama response received")
        return text
    except Exception as e:
        log.error(f"Ollama error: {e}")
        return "<b>⚠️ Ollama error</b>\n<i>Gagal menghubungi model. Cek log server.</i>"


# ──────────────────────────────────────────────
# STEP 4 — CLEAN OUTPUT FOR TELEGRAM HTML
# ──────────────────────────────────────────────
def clean_for_telegram(raw: str) -> str:
    import re

    # Strip markdown code fences Ollama sometimes adds
    raw = re.sub(r"```html\n?", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"```\n?", "", raw)

    # Remove unsupported block tags
    raw = re.sub(r"<\/?(html|body|head|div|section|article|main)[^>]*>", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<span[^>]*>(.*?)<\/span>", r"\1", raw, flags=re.IGNORECASE | re.DOTALL)
    raw = re.sub(r"<p[^>]*>", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<\/p>", "\n", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<h[1-6][^>]*>(.*?)<\/h[1-6]>", r"<b>\1</b>\n", raw, flags=re.IGNORECASE | re.DOTALL)
    raw = re.sub(r"<li[^>]*>(.*?)<\/li>", r"• \1\n", raw, flags=re.IGNORECASE | re.DOTALL)
    raw = re.sub(r"<\/?(ul|ol)[^>]*>", "", raw, flags=re.IGNORECASE)

    # Strip any remaining unknown tags (keep only b/i/u/s/code/pre/a)
    raw = re.sub(r"<(?!\/?(?:b|i|u|s|code|pre|a)(?:\s[^>]*)?>)[^>]+>", "", raw)

    # Normalize whitespace
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


# ──────────────────────────────────────────────
# STEP 4b — EXTRACT RECOMMENDATION KEYWORD
# ──────────────────────────────────────────────
def extract_recommendation(text: str) -> str:
    """
    Pull the action keyword from Ollama output.
    Looks for known keywords in order of specificity.
    Returns a normalised uppercase string e.g. "HOLD", "BUY", "CUT LOSS".
    """
    import re
    keywords = [
        "AVERAGE DOWN",
        "TAKE PROFIT",
        "CUT LOSS",
        "HOLD",
        "MONITOR",
        "BUY SEKARANG",
        "BUY",
        "TRIM",
        "TUNGGU",
        "JUAL",
        "BELI",
    ]
    upper = text.upper()
    for kw in keywords:
        if kw in upper:
            return kw
    return "UNKNOWN"


# ──────────────────────────────────────────────
# STEP 5 — SEND TO TELEGRAM
# ──────────────────────────────────────────────
def send_telegram_request(text: str, chat_id: str, max_retries: int = 3) -> bool:
    """Send a single Telegram message with retry. Returns True on success."""
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={
                    "chat_id": chat_id, "text": text,
                    "parse_mode": "HTML", "disable_web_page_preview": True,
                },
                timeout=15,
            )
            if resp.status_code == 200:
                log.info(f"✉️ Telegram sent ({len(text)} chars)")
                return True
            if resp.status_code == 429:  # rate limited
                wait = min(2 ** attempt, 10)
                time.sleep(wait)
                continue
            log.warning(f"⚠️ Telegram error {resp.status_code}: {resp.text[:200]}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
        except Exception as e:
            log.warning(f"⚠️ Telegram exception: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    return False


def send_telegram(text: str, chat_id: str = TELEGRAM_CHAT_ID):
    if not SEND_TELEGRAM:
        log.info("📵 Telegram disabled — printing instead:")
        print(text)
        print()
        return

    # Chunk to Telegram's 4096 char limit
    LIMIT = 4000
    chunks = []
    if len(text) <= LIMIT:
        chunks = [text]
    else:
        def _split_units(blob: str) -> list[str]:
            """Split blob into units no larger than LIMIT, paragraph then line."""
            units = []
            for para in blob.split("\n\n"):
                if len(para) <= LIMIT:
                    units.append(para)
                else:
                    for line in para.split("\n"):
                        units.append(line)
            return units

        current = ""
        for unit in _split_units(text):
            candidate = current + ("\n\n" if current else "") + unit
            if len(candidate) > LIMIT:
                if current:
                    chunks.append(current.strip())
                current = unit[:LIMIT]  # hard-truncate pathological single lines
            else:
                current = candidate
        if current:
            chunks.append(current.strip())

    total = len(chunks)
    for i, chunk in enumerate(chunks):
        msg = chunk if total == 1 else f"{chunk}\n\n<i>({i+1}/{total})</i>"
        send_telegram_request(msg, chat_id)
        if i < total - 1:
            time.sleep(0.5)


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="IDX Portfolio Analyzer")
    parser.add_argument("tickers", nargs="*", help="Ticker(s) to analyze. Omit for full portfolio.")
    parser.add_argument("--no-telegram", action="store_true", help="Print output instead of sending to Telegram")
    parser.add_argument("--no-llm",      action="store_true", help="Skip Ollama, just print raw data")
    args = parser.parse_args()

    global SEND_TELEGRAM
    if args.no_telegram:
        SEND_TELEGRAM = False

    # Init DB and sync portfolio
    portfolio = load_portfolio()
    init_db()
    upsert_portfolio([{"ticker": k, **v} for k, v in portfolio.items()])

    # Determine which tickers to analyze
    if args.tickers:
        targets = {t.upper(): portfolio.get(t.upper(), {"avg_price": None, "lots": 0, "notes": ""}) for t in args.tickers}
    else:
        targets = portfolio

    now_str = now_wib().strftime("%A, %d %B %Y %H:%M WIB")
    log.info(f"IDX Portfolio Analyzer — {now_str}")
    log.info(f"Tickers: {', '.join(targets.keys())}")
    log.info(f"Model: {OLLAMA_MODEL} | Telegram: {'ON' if SEND_TELEGRAM else 'OFF'}")

    # Send session header to Telegram
    if SEND_TELEGRAM and not args.tickers:
        header = (
            f"<b>📊 IDX Portfolio Update</b>\n"
            f"<i>{now_str}</i>\n\n"
            f"Menganalisis {len(targets)} saham dalam portofolio...\n"
            f"<i>⏳ Mohon tunggu, data sedang diambil dari Yahoo Finance.</i>\n"
            f"<i><a href=\"{get_version_url()}\">v{get_version()}</a></i>"
        )
        send_telegram(header)
        time.sleep(1)

    # Process each ticker
    results = []       # successful tickers
    errors = []        # failed tickers
    total_pnl_sum = 0
    total_invested = 0

    for i, (ticker, meta) in enumerate(targets.items(), 1):
        log.info(f"[{i}/{len(targets)}] {ticker}")
        avg = meta.get("avg_price") if isinstance(meta, dict) else None
        lots_count = meta.get("lots", 0) if isinstance(meta, dict) else 0
        notes_str = meta.get("notes", "") if isinstance(meta, dict) else ""

        # Fetch
        data = fetch_stock(ticker, avg_price=avg, lots=lots_count, notes=notes_str)
        if "error" in data:
            errors.append(ticker)
            log.warning(f"⚠️ Skipping {ticker}: {data['error']}")
            if SEND_TELEGRAM:
                send_telegram(f"⚠️ <b>{ticker}</b> — gagal fetch: <code>{data['error'][:200]}</code>")
            continue

        # Track P&L for end-of-run summary
        if data.get("total_pnl") is not None:
            total_pnl_sum += data["total_pnl"]
        if data.get("avg_price") and data.get("lots"):
            total_invested += data["avg_price"] * data["lots"] * 100

        results.append(ticker)

        # Save raw snapshot to DB (skip if data came from cache)
        if data.get("from_cache"):
            snapshot_id = data.get("id")  # reuse existing snapshot id
            log.info(f"💾 Using cached snapshot (id={snapshot_id})")
        else:
            snapshot_id = save_snapshot(data)
            log.info(f"💾 Snapshot saved (id={snapshot_id})")

        # Optionally skip LLM
        if args.no_llm:
            print(json.dumps(data, indent=2, ensure_ascii=False))
            print()
            continue

        # Fetch trend data for LLM context
        history = get_snapshots(ticker, limit=5)

        # Build prompt → call Ollama → clean
        prompt  = build_prompt(data, history=history)
        raw_llm = call_ollama(prompt)
        clean   = clean_for_telegram(raw_llm)
        rec     = extract_recommendation(clean)
        log.info(f"🎯 Recommendation: {rec}")

        # ── Duplicate suppression ──
        # Send if: recommendation changed, first time, or it's a new calendar day.
        prev      = get_latest_analysis(data["ticker"])
        prev_rec  = (prev.get("recommendation") or "").upper().strip() if prev else ""

        # Check if previous alert was on a different day (WIB = UTC+7)
        new_day = True
        if prev:
            prev_ts = prev.get("analysed_at")
            if prev_ts:
                if prev_ts.tzinfo is None:
                    prev_ts = prev_ts.replace(tzinfo=timezone.utc)
                wib = timezone(timedelta(hours=7))
                prev_day   = prev_ts.astimezone(wib).date()
                today_wib  = datetime.now(wib).date()
                new_day    = (prev_day != today_wib)

        rec_changed = (rec != prev_rec) or not bool(prev_rec) or (rec == "UNKNOWN")
        is_same     = not rec_changed and not new_day
        should_send = SEND_TELEGRAM and not is_same

        if is_same:
            log.info(f"⏭️ Same as previous ({prev_rec}) — skipping Telegram alert")
        elif new_day and not rec_changed and bool(prev_rec):
            log.info(f"📅 New day — resending ({rec})")
            send_telegram(clean)
        else:
            if prev_rec:
                log.info(f"🔔 Changed: {prev_rec} → {rec} — sending alert")
            send_telegram(clean)

        save_analysis(snapshot_id, data["ticker"], OLLAMA_MODEL,
                      raw_llm, clean,
                      recommendation=rec,
                      sent=should_send,
                      skipped_same=is_same)
        log.info(f"💾 Analysis saved")

        # Small delay between stocks to avoid Ollama + Telegram overload
        if i < len(targets):
            time.sleep(random.uniform(3, 6))  # jitter avoids pattern detection

    log.info("✅ Done.")

    # ── End-of-run summary ──
    if SEND_TELEGRAM and not args.tickers:  # only for full portfolio runs
        if not results and errors:
            # All tickers failed
            send_telegram(
                f"🚨 <b>Portfolio fetch gagal total!</b>\n"
                f"Semua {len(errors)} saham error: {', '.join(errors)}\n"
                f"<i>Cek koneksi yfinance/Ollama.</i>"
            )
        elif results:
            total_pct = (total_pnl_sum / total_invested * 100) if total_invested else 0
            pnl_emoji = "📈" if total_pnl_sum >= 0 else "📉"
            summary_lines = [
                f"<b>{pnl_emoji} Portfolio Summary</b>",
                f"✅ {len(results)} saham dianalisis",
            ]
            if errors:
                summary_lines.append(f"⚠️ {len(errors)} gagal: {', '.join(errors)}")
            summary_lines.extend([
                f"",
                f"<b>Total Investasi:</b> <code>{fmt_cap(total_invested)}</code>",
                f"<b>Total P&L:</b> <code>Rp {total_pnl_sum:+,.0f} ({total_pct:+.2f}%)</code>",
                f"",
                f"<i>🤖 {OLLAMA_MODEL} | {now_str} | <a href=\"{get_version_url()}\">v{get_version()}</a></i>",
            ])
            send_telegram("\n".join(summary_lines))


if __name__ == "__main__":
    main()