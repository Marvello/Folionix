# Watchlist Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all watchlist management into a shared `app/watchlist.py` module, expose it via new Telegram bot commands and Streamlit UI controls, merge portfolio CRUD into the Dashboard page, and delete `scripts/watchlist_manager.py`.

**Architecture:** A new `app/watchlist.py` module owns all watchlist business logic (load, save, add, remove, AI suggest). `app/bot.py` imports it for new `/wadd`, `/wremove`, `/wlist` commands and a rewritten `/suggest`. `app/ui.py` imports it for interactive Watchlist management and merges the Positions page CRUD into Dashboard.

**Tech Stack:** Python 3.11+, Streamlit, python-telegram-bot (long-poll), SQLAlchemy Core, requests (Ollama HTTP), dotenv.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/watchlist.py` | **Create** | All watchlist business logic |
| `app/bot.py` | **Modify** | Add `/wadd`, `/wremove`, `/wlist`; rewrite `/suggest` |
| `app/ui.py` | **Modify** | Watchlist CRUD panel; Dashboard gets Positions CRUD; remove Positions nav item |
| `scripts/watchlist_manager.py` | **Delete** | Replaced by above |
| `CLAUDE.md` | **Modify** | Update structure, commands, running section |
| `README.md` | **Modify** | Same |

---

## Task 1: Create `app/watchlist.py`

**Files:**
- Create: `app/watchlist.py`

- [ ] **Step 1: Create the file**

```python
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
```

- [ ] **Step 2: Verify import works**

```bash
cd /Users/marvellooni/Project/idx-portfolio
python -c "from app.watchlist import load_watchlist, add_ticker, remove_ticker, suggest, all_tickers; print('OK')"
```

Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add app/watchlist.py
git commit -m "feat(watchlist): add shared watchlist module"
```

---

## Task 2: Update `app/bot.py` — new commands + rewrite `/suggest`

**Files:**
- Modify: `app/bot.py`

- [ ] **Step 1: Add import at top of bot.py**

After the existing `from app.db import ...` line, add:

```python
from app import watchlist as wl_mod
```

- [ ] **Step 2: Add `cmd_wadd` handler**

Add after `cmd_suggest` (around line 289):

```python
def cmd_wadd(chat_id, args):
    if not args:
        send(chat_id, "⚠️ Format: <code>/wadd TICKER [notes]</code>"); return
    ticker = sanitize_ticker(args[0])
    if not ticker:
        send(chat_id, "⚠️ Ticker tidak valid."); return
    notes = " ".join(args[1:])
    result = wl_mod.add_ticker(ticker, notes)
    icon = "✅" if result["ok"] else "⚠️"
    send(chat_id, f"{icon} {result['message']}")


def cmd_wremove(chat_id, args):
    if not args:
        send(chat_id, "⚠️ Format: <code>/wremove TICKER</code>"); return
    ticker = sanitize_ticker(args[0])
    if not ticker:
        send(chat_id, "⚠️ Ticker tidak valid."); return
    result = wl_mod.remove_ticker(ticker)
    icon = "✅" if result["ok"] else "⚠️"
    send(chat_id, f"{icon} {result['message']}")


def cmd_wlist(chat_id, _):
    wl = wl_mod.load_watchlist()
    user_list = wl.get("user", [])
    ai_list   = wl.get("ai_suggested", [])

    if not user_list and not ai_list:
        send(chat_id, "📋 Watchlist kosong."); return

    lines = ["<b>👀 Watchlist</b>\n"]

    if user_list:
        lines.append("<b>👤 User-added:</b>")
        for e in user_list:
            note = f"  <i>{e['notes']}</i>" if e.get("notes") else ""
            lines.append(f"  • <b>{e['ticker']}</b>{note}")

    if ai_list:
        lines.append("\n<b>🤖 AI-suggested:</b>")
        for e in ai_list:
            rat = f"  <i>{e['rationale'][:80]}</i>" if e.get("rationale") else ""
            lines.append(f"  • <b>{e['ticker']}</b> [{e.get('sector', '')}]{rat}")

    send(chat_id, "\n".join(lines))
```

- [ ] **Step 3: Rewrite `cmd_suggest` to call `wl_mod.suggest()` directly**

Replace the existing `cmd_suggest` function (lines 244-289 in bot.py) with:

```python
def cmd_suggest(chat_id, args):
    try:
        count = int(args[0]) if args else 5
        count = max(1, min(count, 10))
    except ValueError:
        send(chat_id, "⚠️ Format: <code>/suggest [N]</code>"); return

    send(chat_id, f"🤖 Meminta {count} saran saham dari AI… mungkin perlu 1-2 menit.")
    result = wl_mod.suggest(count)

    if not result["ok"]:
        send(chat_id, f"⚠️ {result['message']}"); return

    suggestions = result["suggestions"]
    if not suggestions:
        send(chat_id, "🤷 AI tidak menghasilkan saran kali ini. Coba lagi."); return

    lines = [f"<b>🤖 AI Watchlist Suggestions ({len(suggestions)} stocks)</b>\n"]
    for i, s in enumerate(suggestions, 1):
        lines.append(f"<b>{i}. {s['ticker']}</b> <i>[{s.get('sector', '')}]</i>")
        if s.get("rationale"):
            lines.append(f"   {s['rationale']}")
    lines.append("\n<i>Ditambahkan ke watchlist. Gunakan /wlist untuk melihat.</i>")
    send(chat_id, "\n".join(lines))
```

- [ ] **Step 4: Register new commands in COMMANDS dict**

In the `COMMANDS` dict (around line 313), add:

```python
"/wadd":    cmd_wadd,
"/wremove": cmd_wremove,
"/wlist":   cmd_wlist,
```

- [ ] **Step 5: Update `register_commands()`**

Add to the `commands` list inside `register_commands()`:

```python
{"command": "wadd",    "description": "Tambah ke watchlist: /wadd TICKER [notes]"},
{"command": "wremove", "description": "Hapus dari watchlist: /wremove TICKER"},
{"command": "wlist",   "description": "Lihat watchlist"},
```

- [ ] **Step 6: Update `/help` text in `cmd_help`**

Add these lines to the help message string (after the `/accuracy` line):

```python
"<b>/wadd TICKER [notes]</b> — tambah ke watchlist\n"
"<b>/wremove TICKER</b> — hapus dari watchlist\n"
"<b>/wlist</b> — lihat watchlist\n"
```

- [ ] **Step 7: Verify bot.py imports cleanly**

```bash
cd /Users/marvellooni/Project/idx-portfolio
python -c "import app.bot; print('OK')"
```

Expected: `OK` (no errors, bot won't start because TELEGRAM_TOKEN unset — that's fine)

- [ ] **Step 8: Commit**

```bash
git add app/bot.py
git commit -m "feat(bot): add /wadd, /wremove, /wlist; rewrite /suggest without subprocess"
```

---

## Task 3: Update `app/ui.py` — Watchlist page management panel

**Files:**
- Modify: `app/ui.py`

- [ ] **Step 1: Add watchlist import at top of ui.py**

After the existing `from app.db import ...` line, add:

```python
from app import watchlist as wl_mod
```

- [ ] **Step 2: Replace the Watchlist page block**

Find the `elif page == "Watchlist":` block (starts around line 146). Replace the entire block with:

```python
# ── PAGE: Watchlist ──────────────────────────────────────────────────────────
elif page == "Watchlist":
    st.title("👀 Watchlist")

    wl_data = wl_mod.load_watchlist()
    user_wl = wl_data.get("user", [])
    ai_wl   = wl_data.get("ai_suggested", [])
    all_wl  = user_wl + ai_wl

    # Summary
    col1, col2, col3 = st.columns(3)
    col1.metric("Total Watchlist", len(all_wl))
    col2.metric("User Added", len(user_wl))
    col3.metric("AI Suggested", len(ai_wl))

    st.divider()

    if all_wl:
        wl_rows = []
        for entry in all_wl:
            ticker = entry["ticker"].upper()
            source = "AI" if entry in ai_wl else "User"
            notes  = entry.get("rationale", entry.get("notes", ""))
            snap     = get_latest_snapshot(ticker)
            analysis = get_latest_analysis(ticker)
            price    = snap.get("current_price") if snap else None
            day_pct  = snap.get("day_change_pct") if snap else None
            pe       = snap.get("pe") if snap else None
            pb       = snap.get("pb") if snap else None
            high52   = snap.get("high_52w") if snap else None
            low52    = snap.get("low_52w") if snap else None
            rec      = (analysis.get("recommendation") or "—") if analysis else "—"
            verdict_map  = {"BUY SEKARANG": "🟢", "TUNGGU": "🟡", "HINDARI": "🔴"}
            verdict_icon = verdict_map.get(rec, "")
            wl_rows.append({
                "Ticker":  ticker,
                "Source":  f"{'👤' if source == 'User' else '🤖'} {source}",
                "Harga":   price,
                "Day %":   day_pct,
                "P/E":     pe,
                "P/B":     pb,
                "52W High": high52,
                "52W Low":  low52,
                "Verdict": f"{verdict_icon} {rec}" if rec != "—" else "—",
                "Notes":   notes[:50] if notes else "—",
                "Update":  ts_wib(snap.get("fetched_at")) if snap else "—",
            })

        df_wl = pd.DataFrame(wl_rows)

        def _color_verdict(val):
            if "BUY"    in str(val): return "color: #22c55e"
            if "HINDARI" in str(val): return "color: #ef4444"
            if "TUNGGU" in str(val): return "color: #eab308"
            return ""

        def _color_day(val):
            if val is None or val == 0: return ""
            return "color: #22c55e" if val > 0 else "color: #ef4444"

        styled_wl = (
            df_wl.style
            .format({
                "Harga":    lambda x: fmt_idr(x) if x else "—",
                "Day %":    lambda x: f"{x:+.2f}%" if x else "—",
                "P/E":      lambda x: f"{x:.1f}x" if x else "—",
                "P/B":      lambda x: f"{x:.2f}x" if x else "—",
                "52W High": lambda x: fmt_idr(x) if x else "—",
                "52W Low":  lambda x: fmt_idr(x) if x else "—",
            })
            .map(_color_verdict, subset=["Verdict"])
            .map(_color_day,     subset=["Day %"])
            .set_properties(subset=["Harga", "52W High", "52W Low"], **{"text-align": "right"})
            .set_properties(subset=["Day %", "P/E", "P/B"],           **{"text-align": "right"})
        )
        st.dataframe(styled_wl, use_container_width=True, hide_index=True)

        st.divider()
        st.subheader("Latest Analysis")
        for entry in all_wl:
            ticker   = entry["ticker"].upper()
            analysis = get_latest_analysis(ticker)
            if analysis and analysis.get("clean_html"):
                rec = analysis.get("recommendation") or "—"
                ts  = ts_wib(analysis.get("analysed_at"))
                with st.expander(f"**{ticker}** | {rec} | {ts}"):
                    st.markdown(sanitize_html(analysis.get("clean_html", "")), unsafe_allow_html=True)
    else:
        st.info("Watchlist kosong.")

    # ── Management panel ──────────────────────────────────────────────────────
    st.divider()
    st.subheader("🛠️ Kelola Watchlist")

    with st.expander("➕ Tambah Ticker"):
        c1, c2, c3 = st.columns([1, 2, 1])
        wl_add_ticker = c1.text_input("Ticker", placeholder="TLKM", key="wl_add_ticker").upper()
        wl_add_notes  = c2.text_input("Notes", placeholder="Alasan watchlist", key="wl_add_notes")
        if c3.button("Tambah", key="wl_add_btn"):
            if not wl_add_ticker:
                st.error("Ticker wajib diisi.")
            else:
                res = wl_mod.add_ticker(wl_add_ticker, wl_add_notes)
                if res["ok"]:
                    st.success(res["message"])
                    st.rerun()
                else:
                    st.error(res["message"])

    with st.expander("🗑️ Hapus Ticker"):
        all_current = wl_mod.all_tickers(wl_mod.load_watchlist())
        if all_current:
            c1, c2 = st.columns([3, 1])
            wl_rm_ticker = c1.selectbox("Pilih ticker", all_current, key="wl_rm_ticker")
            if c2.button("Hapus", key="wl_rm_btn"):
                res = wl_mod.remove_ticker(wl_rm_ticker)
                if res["ok"]:
                    st.success(res["message"])
                    st.rerun()
                else:
                    st.error(res["message"])
        else:
            st.info("Watchlist kosong.")

    with st.expander("🤖 AI Saran Saham"):
        c1, c2 = st.columns([1, 3])
        wl_sug_count = c1.number_input("Jumlah saran", min_value=1, max_value=10, value=5, key="wl_sug_count")
        if c2.button("Minta Saran AI", key="wl_sug_btn"):
            with st.spinner("Menghubungi AI… mungkin 1-2 menit."):
                res = wl_mod.suggest(int(wl_sug_count))
            if res["ok"]:
                st.success(res["message"])
                st.rerun()
            else:
                st.error(res["message"])
```

- [ ] **Step 3: Verify ui.py has no syntax errors**

```bash
cd /Users/marvellooni/Project/idx-portfolio
python -m py_compile app/ui.py && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add app/ui.py
git commit -m "feat(ui): add watchlist management panel (add/remove/AI suggest)"
```

---

## Task 4: Update `app/ui.py` — Merge Positions into Dashboard, remove Positions page

**Files:**
- Modify: `app/ui.py`

- [ ] **Step 1: Remove "Positions" from sidebar nav**

Find the `page = st.sidebar.radio(...)` line (around line 46). Change it from:

```python
page = st.sidebar.radio("Navigation", ["Dashboard", "Watchlist", "Positions", "History", "Analysis Log", "Accuracy"])
```

to:

```python
page = st.sidebar.radio("Navigation", ["Dashboard", "Watchlist", "History", "Analysis Log", "Accuracy"])
```

- [ ] **Step 2: Append position management panel to the Dashboard page**

Find the end of the `if page == "Dashboard":` block (just before `elif page == "Watchlist":`). Add this at the end of the Dashboard block:

```python
    # ── Kelola Posisi ─────────────────────────────────────────────────────────
    st.divider()
    st.subheader("🗂️ Kelola Posisi")

    if positions:
        for pos in positions.values():
            with st.expander(f"**{pos['ticker']}** — {pos['lots']} lot @ {fmt_idr(pos['avg_price'], 2)}"):
                ec1, ec2, ec3 = st.columns(3)
                new_avg   = ec1.number_input("Avg Price (Rp)", value=float(pos["avg_price"]),
                                              step=1.0, key=f"dash_avg_{pos['ticker']}")
                new_lots  = ec2.number_input("Lots", value=int(pos["lots"]),
                                              step=1,   key=f"dash_lots_{pos['ticker']}")
                new_notes = ec3.text_input("Notes", value=pos.get("notes", ""),
                                            key=f"dash_notes_{pos['ticker']}")
                bc1, bc2 = st.columns([1, 4])
                if bc1.button("💾 Simpan", key=f"dash_save_{pos['ticker']}"):
                    upsert_position(pos["ticker"], new_avg, new_lots, new_notes)
                    sync_portfolio_json(PORTFOLIO_FILE)
                    st.success(f"✅ {pos['ticker']} diperbarui.")
                    st.rerun()
                if bc2.button("🗑️ Nonaktifkan", key=f"dash_del_{pos['ticker']}"):
                    deactivate_position(pos["ticker"])
                    sync_portfolio_json(PORTFOLIO_FILE)
                    st.warning(f"⚠️ {pos['ticker']} dinonaktifkan.")
                    st.rerun()

    st.subheader("➕ Tambah Posisi Baru")
    nc1, nc2, nc3, nc4 = st.columns(4)
    new_ticker = nc1.text_input("Ticker", placeholder="BBCA", key="dash_new_ticker").upper()
    new_avg    = nc2.number_input("Avg Price (Rp)", min_value=0.0, step=1.0, key="dash_new_avg")
    new_lots   = nc3.number_input("Lots", min_value=0, step=1, key="dash_new_lots")
    new_notes  = nc4.text_input("Notes", placeholder="Optional", key="dash_new_notes")

    if st.button("➕ Tambah", key="dash_add_btn"):
        if not new_ticker or not re.match(r"^[A-Z0-9]{1,10}$", new_ticker):
            st.error("Ticker tidak valid (1-10 huruf/angka).")
        elif new_avg <= 0 or new_lots <= 0:
            st.error("Avg Price dan Lots harus > 0.")
        else:
            upsert_position(new_ticker, new_avg, int(new_lots), new_notes)
            sync_portfolio_json(PORTFOLIO_FILE)
            st.success(f"✅ {new_ticker} ditambahkan.")
            st.rerun()
```

Note: `positions` in the Dashboard block is already `{p["ticker"]: p for p in get_all_positions()}` — use `.values()` to iterate.

- [ ] **Step 3: Delete the old Positions page block entirely**

Remove the entire `elif page == "Positions":` block (currently lines 269-320). It starts with:

```python
# ── PAGE: Positions (CRUD) ────────────────────────────────────────────────────
elif page == "Positions":
```

and ends just before `# ── PAGE: History`.

- [ ] **Step 4: Verify no syntax errors**

```bash
cd /Users/marvellooni/Project/idx-portfolio
python -m py_compile app/ui.py && echo "OK"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add app/ui.py
git commit -m "feat(ui): merge Positions CRUD into Dashboard, remove Positions page"
```

---

## Task 5: Delete `scripts/watchlist_manager.py`

**Files:**
- Delete: `scripts/watchlist_manager.py`

- [ ] **Step 1: Delete the file**

```bash
git rm scripts/watchlist_manager.py
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove scripts/watchlist_manager.py — replaced by app/watchlist.py"
```

---

## Task 6: Update `CLAUDE.md` and `README.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update `CLAUDE.md` project structure**

In the `## Project Structure` section, replace the `scripts/` block:

```
scripts/                    # Utility scripts
├── watchlist_manager.py    # CLI: add/remove/suggest watchlist tickers
```

with:

```
app/
├── watchlist.py            # Watchlist business logic (shared by bot + UI)
```

(add `watchlist.py` to the `app/` tree listing)

- [ ] **Step 2: Update `CLAUDE.md` Running Locally section**

Remove:

```
# Watchlist management
python scripts/watchlist_manager.py add TLKM "Defensive telco"
python scripts/watchlist_manager.py suggest
```

- [ ] **Step 3: Update `CLAUDE.md` bot command list**

In the `app/bot.py` description or wherever commands are mentioned, add:

```
/wadd TICKER [notes]   — add ticker to watchlist
/wremove TICKER        — remove ticker from watchlist
/wlist                 — show current watchlist
```

- [ ] **Step 4: Update `README.md` similarly**

Apply the same three changes to `README.md`:
- Add `app/watchlist.py` to structure
- Remove `scripts/watchlist_manager.py` CLI examples
- Add `/wadd`, `/wremove`, `/wlist` to bot command list

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md and README.md for watchlist consolidation"
```

---

## Final Verification

- [ ] Run full test suite:

```bash
cd /Users/marvellooni/Project/idx-portfolio
pytest tests/ -v
```

Expected: all existing tests pass (no watchlist-specific tests required per spec).

- [ ] Confirm `scripts/` no longer contains `watchlist_manager.py`:

```bash
ls scripts/
```

Expected: empty or only other unrelated files.

- [ ] Confirm bot imports clean:

```bash
python -c "import app.bot; print('bot OK')"
python -c "import app.ui; print('ui OK')" 2>/dev/null || echo "ui needs streamlit context — expected"
python -c "from app.watchlist import load_watchlist, add_ticker, remove_ticker, suggest; print('watchlist OK')"
```
