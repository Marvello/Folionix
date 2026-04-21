#!/usr/bin/env python3
"""
bot.py — Telegram bot for IDX Portfolio management
Commands:
  /status              — all positions + latest P&L
  /add TICKER AVGPRICE LOTS [notes]
  /update TICKER AVGPRICE LOTS
  /remove TICKER
  /analyze TICKER      — trigger on-demand analysis
  /help
"""

import os, sys, time, logging, requests, subprocess, re
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
PORTFOLIO_FILE   = os.getenv("PORTFOLIO_FILE", "/app/portfolio.json")
ALLOWED_CHAT_ID  = str(TELEGRAM_CHAT_ID)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import (init_db, upsert_position, deactivate_position,
                get_all_positions, get_latest_snapshot, get_latest_analysis,
                sync_portfolio_json, get_recommendation_accuracy)
from utils import fmt_idr, fmt_cap, pnl_icon, calc_pnl, get_version

BASE = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

def sanitize_ticker(raw: str) -> str | None:
    """Allow only 1-10 uppercase alphanumeric chars."""
    t = raw.upper().strip()
    if re.match(r"^[A-Z0-9]{1,10}$", t):
        return t
    return None

def send(chat_id, text, parse_mode="HTML", max_retries=3):
    for attempt in range(max_retries):
        try:
            resp = requests.post(f"{BASE}/sendMessage", json={
                "chat_id": chat_id, "text": text,
                "parse_mode": parse_mode, "disable_web_page_preview": True,
            }, timeout=15)
            if resp.status_code == 200:
                return
            if resp.status_code == 429:
                time.sleep(min(2 ** attempt, 10))
                continue
            log.warning(f"Telegram {resp.status_code}: {resp.text[:200]}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
        except Exception as e:
            log.error(f"Send error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

def get_updates(offset=0):
    try:
        r = requests.get(f"{BASE}/getUpdates",
            params={"offset": offset, "timeout": 30, "allowed_updates": ["message"]},
            timeout=35)
        return r.json().get("result", [])
    except Exception:
        return []

# ── Handlers ──────────────────────────────────

def cmd_help(chat_id, _):
    send(chat_id, (
        "<b>📋 IDX Portfolio Bot</b>\n\n"
        "<b>/status</b> — semua posisi + P&amp;L\n"
        "<b>/add TICKER AVGPRICE LOTS [notes]</b>\n"
        "  <code>/add BBCA 8674.55 57 BCA blue chip</code>\n"
        "<b>/update TICKER AVGPRICE LOTS</b>\n"
        "  <code>/update BMRI 4500 120</code>\n"
        "<b>/remove TICKER</b> — nonaktifkan posisi\n"
        "<b>/analyze TICKER</b> — analisis on-demand\n"
        "<b>/portfolio</b> — export semua posisi\n"
        "<b>/accuracy [HARI]</b> — akurasi rekomendasi (default: 3 hari)\n"
        "  <code>/accuracy 7</code>\n"
        "<b>/help</b> — bantuan ini"
    ))

def cmd_status(chat_id, _):
    positions = get_all_positions()
    if not positions:
        send(chat_id, "📭 Portfolio kosong."); return

    lines = ["<b>📊 Portfolio Status</b>\n"]
    total_inv = total_pnl_all = 0

    for pos in positions:
        ticker, avg, lots = pos["ticker"], pos["avg_price"], pos["lots"]
        snap     = get_latest_snapshot(ticker)
        analysis = get_latest_analysis(ticker)

        if snap and snap.get("current_price"):
            price = snap["current_price"]
            p     = calc_pnl(price, avg, lots)
            rec   = (analysis.get("recommendation") or "—") if analysis else "—"
            total_inv     += p["invested"]
            total_pnl_all += p["total_pnl"]
            lines.append(
                f"{pnl_icon(p['pnl_pct'])} <b>{ticker}</b> {lots}lot "
                f"<code>{fmt_idr(price)}</code> "
                f"({'+' if p['pnl_pct'] >= 0 else ''}{p['pnl_pct']:.1f}%) "
                f"P&amp;L: <code>Rp {p['total_pnl']:+,.0f}</code> | {rec}"
            )
        else:
            lines.append(f"❓ <b>{ticker}</b> {lots}lot — belum ada data")

    if total_inv > 0:
        total_pct = (total_pnl_all / total_inv) * 100
        lines.append(
            f"\n<b>Total Investasi :</b> {fmt_cap(total_inv)}\n"
            f"<b>Total P&amp;L    :</b> <code>Rp {total_pnl_all:+,.0f} ({total_pct:+.2f}%)</code>"
        )
    send(chat_id, "\n".join(lines))

def cmd_add(chat_id, args):
    if len(args) < 3:
        send(chat_id, "⚠️ Format: <code>/add TICKER AVGPRICE LOTS [notes]</code>"); return
    ticker = sanitize_ticker(args[0])
    if not ticker:
        send(chat_id, "⚠️ Ticker tidak valid. Gunakan huruf/angka saja (maks 10 karakter).")
        return
    try:
        avg  = float(args[1].replace(",", ""))
        lots = int(args[2])
    except ValueError:
        send(chat_id, "⚠️ AVGPRICE harus angka, LOTS harus bilangan bulat."); return
    notes = " ".join(args[3:]) if len(args) > 3 else ""
    upsert_position(ticker, avg, lots, notes)
    sync_portfolio_json(PORTFOLIO_FILE)
    send(chat_id, (
        f"✅ <b>{ticker}</b> disimpan\n"
        f"Avg: <code>{fmt_idr(avg)}</code> | Lots: <code>{lots}</code> | "
        f"Invested: <code>{fmt_cap(avg * lots * 100)}</code>"
    ))

def cmd_update(chat_id, args):
    cmd_add(chat_id, args)

def cmd_remove(chat_id, args):
    if not args:
        send(chat_id, "⚠️ Format: <code>/remove TICKER</code>"); return
    ticker = sanitize_ticker(args[0])
    if not ticker:
        send(chat_id, "⚠️ Ticker tidak valid.")
        return
    if not any(p["ticker"] == ticker for p in get_all_positions()):
        send(chat_id, f"⚠️ <b>{ticker}</b> tidak ditemukan."); return
    deactivate_position(ticker)
    sync_portfolio_json(PORTFOLIO_FILE)
    send(chat_id, f"🗑️ <b>{ticker}</b> dinonaktifkan.")

def cmd_analyze(chat_id, args):
    if not args:
        send(chat_id, "⚠️ Format: <code>/analyze TICKER</code>"); return
    ticker = sanitize_ticker(args[0])
    if not ticker:
        send(chat_id, "⚠️ Ticker tidak valid.")
        return
    send(chat_id, f"⏳ Menganalisis <b>{ticker}</b>...")
    try:
        result = subprocess.run(
            ["python", "/app/fetch_portfolio.py", ticker],
            capture_output=True, text=True, timeout=180
        )
        if result.returncode != 0:
            send(chat_id, f"⚠️ Error:\n<code>{result.stderr[-300:]}</code>")
    except subprocess.TimeoutExpired:
        send(chat_id, f"⚠️ Timeout saat menganalisis {ticker}.")
    except Exception as e:
        send(chat_id, f"⚠️ Error: <code>{e}</code>")

def cmd_accuracy(chat_id, args):
    try:
        days = int(args[0]) if args else 3
    except ValueError:
        send(chat_id, "⚠️ Format: <code>/accuracy [HARI]</code>"); return
    results = get_recommendation_accuracy(days_after=days)
    if not results:
        send(chat_id, "📊 Belum cukup data untuk evaluasi akurasi."); return

    correct_count = sum(1 for r in results if r["correct"] is True)
    total = sum(1 for r in results if r["correct"] is not None)
    accuracy = (correct_count / total * 100) if total else 0

    lines = [
        f"<b>📊 Akurasi Rekomendasi ({days} hari)</b>",
        f"✅ Benar: {correct_count}/{total} ({accuracy:.0f}%)",
        "",
    ]

    # Show last 10 results
    for r in results[:10]:
        icon = "✅" if r["correct"] else ("❌" if r["correct"] is False else "❓")
        lines.append(
            f"{icon} <b>{r['ticker']}</b> {r['recommendation']} "
            f"→ {r['actual_change_pct']:+.1f}%"
        )

    if len(results) > 10:
        lines.append(f"\n<i>... dan {len(results) - 10} lainnya</i>")

    send(chat_id, "\n".join(lines))

def cmd_portfolio(chat_id, _):
    positions = get_all_positions()
    if not positions:
        send(chat_id, "📭 Portfolio kosong."); return

    lines = ["<b>📋 Portfolio Export</b>\n"]
    total_invested = 0
    for pos in positions:
        invested = pos["avg_price"] * pos["lots"] * 100
        total_invested += invested
        lines.append(
            f"<b>{pos['ticker']}</b> | {pos['lots']}lot "
            f"@ <code>{fmt_idr(pos['avg_price'], 2)}</code> "
            f"= <code>{fmt_cap(invested)}</code>"
        )
        if pos.get("notes"):
            lines.append(f"  <i>{pos['notes']}</i>")

    lines.append(f"\n<b>Total Modal:</b> <code>{fmt_cap(total_invested)}</code>")
    send(chat_id, "\n".join(lines))

COMMANDS = {
    "/help": cmd_help, "/start": cmd_help,
    "/status": cmd_status,
    "/add": cmd_add, "/update": cmd_update,
    "/remove": cmd_remove,
    "/analyze": cmd_analyze,
    "/portfolio": cmd_portfolio,
    "/accuracy": cmd_accuracy,
}

def handle_message(message):
    chat_id = str(message.get("chat", {}).get("id", ""))
    text    = message.get("text", "").strip()
    if not text or not chat_id: return
    if chat_id != ALLOWED_CHAT_ID:
        log.warning(f"Rejected from chat_id={chat_id}"); return
    parts   = text.split()
    command = parts[0].lower().split("@")[0]
    args    = parts[1:]
    handler = COMMANDS.get(command)
    if handler:
        log.info(f"Command: {command} {args}")
        try:
            handler(chat_id, args)
        except Exception as e:
            log.error(f"Handler error: {e}", exc_info=True)
            send(chat_id, f"⚠️ Error: <code>{e}</code>")
    else:
        send(chat_id, f"❓ Command tidak dikenal. Ketik /help")

def main():
    if not TELEGRAM_TOKEN:
        log.error("TELEGRAM_TOKEN not set"); sys.exit(1)
    init_db()
    log.info(f"Bot started. Allowed chat_id={ALLOWED_CHAT_ID}")
    send(ALLOWED_CHAT_ID, f"🤖 <b>IDX Portfolio Bot online.</b> v{get_version()} | Ketik /help.")
    offset = 0
    while True:
        try:
            updates = get_updates(offset)
            for upd in updates:
                offset = upd["update_id"] + 1
                if "message" in upd:
                    handle_message(upd["message"])
        except KeyboardInterrupt:
            log.info("Bot stopped."); break
        except Exception as e:
            log.error(f"Polling error: {e}"); time.sleep(5)

if __name__ == "__main__":
    main()