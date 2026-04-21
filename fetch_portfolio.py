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
from datetime import datetime, timedelta, timezone
from typing import Optional

import yfinance as yf
import requests
from dotenv import load_dotenv
from db import init_db, upsert_portfolio, save_snapshot, save_analysis, get_latest_snapshot, get_latest_analysis
from utils import (safe_float, fmt_idr, fmt_cap, sign, normalize_ticker,
                   WIB, now_wib, fmt_wib)

load_dotenv()

# ──────────────────────────────────────────────
# CONFIG — edit .env to change these
# ──────────────────────────────────────────────
OLLAMA_URL       = os.getenv("OLLAMA_URL",      "http://localhost:11434")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL",    "qwen2.5:7b")
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN",  "YOUR_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID","YOUR_CHAT_ID")
SEND_TELEGRAM    = os.getenv("SEND_TELEGRAM",   "true").lower() == "true"
PORTFOLIO_FILE   = os.getenv("PORTFOLIO_FILE",  "portfolio.json")
CACHE_MINUTES    = int(os.getenv("CACHE_MINUTES", "30"))


# ──────────────────────────────────────────────
# LOAD PORTFOLIO FROM JSON
# ──────────────────────────────────────────────
def load_portfolio() -> dict:
    """Load positions from portfolio.json. Returns {TICKER: {avg_price, lots, notes}}."""
    path = os.path.join(os.path.dirname(__file__), PORTFOLIO_FILE)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Portfolio file not found: {path}")
    with open(path) as f:
        data = json.load(f)
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

PORTFOLIO = load_portfolio()


# ──────────────────────────────────────────────
# STEP 1 — FETCH DATA
# ──────────────────────────────────────────────
def fetch_stock(ticker: str, avg_price: Optional[float] = None) -> dict:
    """
    Fetch price + fundamentals via yfinance with retry + backoff.
    Uses fast_info first (lighter), then info with up to 3 retries.
    """
    symbol = normalize_ticker(ticker)
    print(f"  📡 Fetching {symbol}...", end=" ", flush=True)

    # ── Cache check ──
    cached = get_latest_snapshot(ticker)
    if cached:
        fetched = cached["fetched_at"]
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - fetched).total_seconds() / 60
        if age < CACHE_MINUTES:
            print(f"✓ (cached {age:.0f}m ago)")
            # Always re-read lots + avg_price from portfolio.json (not from snapshot)
            # so changes to portfolio.json take effect immediately without cache bust
            pos             = PORTFOLIO.get(ticker.upper(), {})
            current_price   = cached.get("current_price")
            avg_price_live  = pos.get("avg_price") or cached.get("avg_price")
            lots_live       = pos.get("lots", 0)
            pnl_live        = round(current_price - avg_price_live, 0) if (current_price and avg_price_live) else None
            pnl_pct_live    = round((pnl_live / avg_price_live) * 100, 2) if (pnl_live and avg_price_live) else None
            total_pnl_live  = round(pnl_live * lots_live * 100, 0) if (pnl_live and lots_live) else None

            cached["lots"]               = lots_live
            cached["avg_price"]          = avg_price_live
            cached["unrealized_pnl"]     = pnl_live
            cached["unrealized_pnl_pct"] = pnl_pct_live
            cached["total_pnl"]          = total_pnl_live
            cached["notes"]              = pos.get("notes", "")
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
            fi    = stock.fast_info
            info  = stock.info
            break
        except Exception as e:
            err_str = str(e)
            is_rate_limit = any(x in err_str for x in ["429", "Too Many Requests", "Rate limited"])
            if is_rate_limit and attempt < MAX_RETRIES - 1:
                wait = 5 * (2 ** attempt)   # 5s → 10s → 20s
                print(f"\n  ⏳ Rate limited. Waiting {wait}s (attempt {attempt+1}/{MAX_RETRIES})...",
                      end=" ", flush=True)
                time.sleep(wait)
            else:
                print(f"ERROR: {e}")
                return {"ticker": ticker, "error": str(e)}

    # ── Price ──
    current = safe_float(
        info.get("currentPrice") or info.get("regularMarketPrice") or fi.last_price, 0
    )
    prev = safe_float(
        info.get("regularMarketPreviousClose") or fi.previous_close, 0
    )
    day_chg     = round(current - prev, 0) if (current and prev) else None
    day_chg_pct = round((day_chg / prev) * 100, 2) if (day_chg and prev) else None
    high52 = safe_float(info.get("fiftyTwoWeekHigh") or fi.fifty_two_week_high, 0)
    low52  = safe_float(info.get("fiftyTwoWeekLow")  or fi.fifty_two_week_low,  0)
    volume = safe_float(info.get("regularMarketVolume") or fi.last_volume, 0)

    # ── P&L vs avg buy price ──
    pnl = pnl_pct = total_pnl = None
    position_status = "N/A"
    lots = PORTFOLIO.get(ticker.upper(), {}).get("lots", 0)
    if current and avg_price:
        pnl       = round(current - avg_price, 0)           # per share
        pnl_pct   = round((pnl / avg_price) * 100, 2)
        total_pnl = round(pnl * lots * 100, 0)              # lots × 100 shares/lot
        if   pnl_pct >=  10: position_status = "🟢 PROFIT SIGNIFIKAN"
        elif pnl_pct >=   2: position_status = "🟢 PROFIT"
        elif pnl_pct >=  -2: position_status = "⚪ BREAKEVEN ZONE"
        elif pnl_pct >= -10: position_status = "🟡 RUGI TIPIS"
        elif pnl_pct >= -20: position_status = "🔴 RUGI"
        else:                position_status = "🔴 RUGI DALAM"

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

    print("✓")
    return {
        "ticker":             ticker.upper(),
        "symbol":             symbol,
        "name":               info.get("longName") or info.get("shortName", symbol),
        "sector":             info.get("sector", "N/A"),
        "industry":           info.get("industry", "N/A"),
        "notes":              PORTFOLIO.get(ticker.upper(), {}).get("notes", ""),
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
def build_prompt(d: dict) -> str:
    now = now_wib()  # from utils — returns WIB-aware datetime
    hour = now.hour
    minute = now.minute

    # Session context
    if   hour == 9  and minute == 0:  session = "PEMBUKAAN SESI 1 (09:00)"
    elif hour == 10:                   session = "SESI 1 — 10:00 WIB"
    elif hour == 11:                   session = "SESI 1 — 11:00 WIB (1 jam menuju tutup)"
    elif hour == 12:                   session = "PENUTUPAN SESI 1 (12:00)"
    elif hour == 13:                   session = "PEMBUKAAN SESI 2 (13:30)"
    elif hour == 14 and minute >= 30:  session = "SESI 2 — 14:30 WIB (30 mnt menuju penutupan ⚠️)"
    elif hour == 15:                   session = "PENUTUPAN PASAR (15:00)"
    else:                              session = f"UPDATE PORTOFOLIO ({hour:02d}:{minute:02d} WIB)"

    ACTION_THRESHOLD = int(os.getenv("ACTION_THRESHOLD_IDR", "1000000"))  # default Rp 1jt
    pnl_block = ""
    if d.get("avg_price") and d.get("current_price"):
        total_pnl    = d.get("total_pnl") or 0
        lots         = d.get("lots", 0)
        total_invest = (d["avg_price"] * lots * 100) if (d.get("avg_price") and lots) else None
        above_thresh = abs(total_pnl) >= ACTION_THRESHOLD
        thresh_note  = (
            f"Total P&L Rp {total_pnl:+,.0f} {'✅ di atas' if above_thresh else '⚠️ di bawah'} "
            f"threshold aksi (Rp {ACTION_THRESHOLD:,.0f}). "
            f"{'Pertimbangkan aksi.' if above_thresh else 'Cukup monitor saja, belum perlu aksi.'}"
        )
        pnl_block = f"""
POSISI INVESTOR:
- Lot Dipegang          : {lots} lot ({lots*100:,} lembar)
- Modal Investasi       : {fmt_cap(total_invest) if total_invest else "N/A"}
- Harga Beli Rata-rata  : Rp {d['avg_price']:,.2f}
- Harga Sekarang        : {fmt_idr(d['current_price'])}
- P&L per Lembar        : {fmt_idr(d['unrealized_pnl'])} ({sign(d['unrealized_pnl_pct'])}{d['unrealized_pnl_pct']}%)
- Total P&L             : Rp {total_pnl:+,.0f}
- Status                : {d['position_status']}
- Threshold Aksi        : {thresh_note}
- Jarak dari 52W High   : {d['dist_from_high']}%
- Jarak dari 52W Low    : {d['dist_from_low']}%"""

    return f"""Kamu adalah analis saham IDX yang membantu investor retail memutuskan BUY/SELL/HOLD secara real-time.

=== SESI BURSA: {session} ===

=== {d['ticker']} — {d['name']} ===
Sektor: {d['sector']} | {d['industry']}
Konteks: {d['notes']}

HARGA:
- Sekarang : {fmt_idr(d['current_price'])} ({d['day_arrow']} {sign(d['day_change_pct'])}{d['day_change_pct']}%)
- Volume   : {d['volume']:,} lot
- 52W High : {fmt_idr(d['high_52w'])} | 52W Low: {fmt_idr(d['low_52w'])}
{pnl_block}

FUNDAMENTAL:
- P/E: {d['pe']}x | P/B: {d['pb']}x | Beta: {d['beta']}
- ROE: {d['roe_pct']}% | Profit Margin: {d['profit_margin_pct']}%
- Dividend Yield: {d['div_yield_pct']}% | EPS: {fmt_idr(d['eps'], 2)}
- Debt/Equity: {d['debt_to_equity']} | Market Cap: {d['market_cap']}

INSTRUKSI FORMAT:
Tulis HANYA dalam HTML Telegram. Gunakan HANYA tag: <b>, <i>, <code>.
JANGAN gunakan Markdown (**, ##, -, *). JANGAN tulis ```html atau ```.
Maksimal 200 kata.

FORMAT WAJIB (isi bagian dalam kurung siku):

<b>{d['ticker']} {d['pnl_arrow']} {d['position_status']}</b>
<i>{d['name']} | {d['day_arrow']} {sign(d['day_change_pct'])}{d['day_change_pct']}% | {session}</i>

<b>📍 Posisi Kamu</b>
{d.get('lots',0)} lot | Beli: <code>Rp {d['avg_price']:,.2f}</code> → Sekarang: <code>{fmt_idr(d['current_price'])}</code>
P&L/lembar: <code>{fmt_idr(d['unrealized_pnl'])} ({sign(d['unrealized_pnl_pct'])}{d['unrealized_pnl_pct']}%)</code>
Total P&L: <code>Rp {(d.get('total_pnl') or 0):+,.0f}</code>
[1 kalimat konteks posisi]

<b>⚡ Aksi Disarankan Sekarang</b>
[Jika total P&L di bawah Rp 1.000.000: tulis MONITOR — belum material untuk aksi]
[Jika total P&L di atas Rp 1.000.000: BUY / AVERAGE DOWN / HOLD / TRIM / CUT LOSS — alasan 2 kalimat + level harga]

<b>⚠️ Watch Out</b>
[1 risiko spesifik hari ini]

<i>Bukan rekomendasi investasi resmi. DYOR.</i>"""


# ──────────────────────────────────────────────
# STEP 3 — CALL OLLAMA
# ──────────────────────────────────────────────
def call_ollama(prompt: str) -> str:
    print(f"  🤖 Calling Ollama ({OLLAMA_MODEL})...", end=" ", flush=True)
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
                    "num_predict": 1024,   # raised — gemma4 needs more room
                    "num_ctx":     4096,   # explicit context window
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
            print(f"WARN: empty response (done_reason={done_reason})")
            return f"<b>⚠️ Model returned empty response</b>\n<i>done_reason: {done_reason}</i>"

        print("✓")
        return text
    except Exception as e:
        print(f"ERROR: {e}")
        return f"<b>⚠️ Ollama error</b>\n<code>{e}</code>"


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
def send_telegram(text: str, chat_id: str = TELEGRAM_CHAT_ID):
    if not SEND_TELEGRAM:
        print("  📵 Telegram disabled — printing instead:\n")
        print(text)
        print()
        return

    # Chunk to Telegram's 4096 char limit
    LIMIT = 4000
    chunks = []
    if len(text) <= LIMIT:
        chunks = [text]
    else:
        paragraphs = text.split("\n\n")
        current = ""
        for para in paragraphs:
            candidate = current + ("\n\n" if current else "") + para
            if len(candidate) > LIMIT:
                if current:
                    chunks.append(current.strip())
                current = para
            else:
                current = candidate
        if current:
            chunks.append(current.strip())

    total = len(chunks)
    for i, chunk in enumerate(chunks):
        msg = chunk if total == 1 else f"{chunk}\n\n<i>({i+1}/{total})</i>"
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={
                    "chat_id":                chat_id,
                    "text":                   msg,
                    "parse_mode":             "HTML",
                    "disable_web_page_preview": True,
                },
                timeout=15,
            )
            if resp.status_code == 200:
                print(f"  ✉️  Telegram sent ({len(msg)} chars)")
            else:
                print(f"  ⚠️  Telegram error {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"  ⚠️  Telegram exception: {e}")

        if i < total - 1:
            time.sleep(0.5)  # avoid Telegram flood limit


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
    init_db()
    upsert_portfolio(list(PORTFOLIO.values()) if False else [
        {"ticker": k, **v} for k, v in PORTFOLIO.items()
    ])

    # Determine which tickers to analyze
    if args.tickers:
        targets = {t.upper(): PORTFOLIO.get(t.upper(), {"avg_price": None, "lots": 0, "notes": ""}) for t in args.tickers}
    else:
        targets = PORTFOLIO

    now_str = now_wib().strftime("%A, %d %B %Y %H:%M WIB")
    print(f"\n{'='*55}")
    print(f"  IDX Portfolio Analyzer — {now_str}")
    print(f"  Tickers : {', '.join(targets.keys())}")
    print(f"  Model   : {OLLAMA_MODEL}")
    print(f"  Telegram: {'ON' if SEND_TELEGRAM else 'OFF (print mode)'}")
    print(f"{'='*55}\n")

    # Send session header to Telegram
    if SEND_TELEGRAM and not args.tickers:
        header = (
            f"<b>📊 IDX Portfolio Update</b>\n"
            f"<i>{now_str}</i>\n\n"
            f"Menganalisis {len(targets)} saham dalam portofolio...\n"
            f"<i>⏳ Mohon tunggu, data sedang diambil dari Yahoo Finance.</i>"
        )
        send_telegram(header)
        time.sleep(1)

    # Process each ticker
    for i, (ticker, meta) in enumerate(targets.items(), 1):
        print(f"[{i}/{len(targets)}] {ticker}")
        avg = meta.get("avg_price") if isinstance(meta, dict) else None

        # Fetch
        data = fetch_stock(ticker, avg_price=avg)
        if "error" in data:
            print(f"  ⚠️  Skipping {ticker}: {data['error']}\n")
            continue

        # Save raw snapshot to DB (skip if data came from cache)
        if data.get("from_cache"):
            snapshot_id = data.get("id")  # reuse existing snapshot id
            print(f"  💾 Using cached snapshot (id={snapshot_id})")
        else:
            snapshot_id = save_snapshot(data)
            print(f"  💾 Snapshot saved (id={snapshot_id})")

        # Optionally skip LLM
        if args.no_llm:
            print(json.dumps(data, indent=2, ensure_ascii=False))
            print()
            continue

        # Build prompt → call Ollama → clean
        prompt  = build_prompt(data)
        raw_llm = call_ollama(prompt)
        clean   = clean_for_telegram(raw_llm)
        rec     = extract_recommendation(clean)
        print(f"  🎯 Recommendation: {rec}")

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
            print(f"  ⏭️  Same as previous ({prev_rec}) — skipping Telegram alert")
        elif new_day and not rec_changed and bool(prev_rec):
            print(f"  📅 New day — resending ({rec})")
            send_telegram(clean)
        else:
            if prev_rec:
                print(f"  🔔 Changed: {prev_rec} → {rec} — sending alert")
            send_telegram(clean)

        save_analysis(snapshot_id, data["ticker"], OLLAMA_MODEL,
                      raw_llm, clean,
                      recommendation=rec,
                      sent=should_send,
                      skipped_same=is_same)
        print(f"  💾 Analysis saved")

        # Small delay between stocks to avoid Ollama + Telegram overload
        if i < len(targets):
            time.sleep(random.uniform(3, 6))  # jitter avoids pattern detection

        print()

    print("✅ Done.")


if __name__ == "__main__":
    main()