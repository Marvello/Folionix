# Watchlist Management — Design Spec
Date: 2026-04-22

## Goal

Consolidate all watchlist management into the Telegram bot and Streamlit UI.
Delete `scripts/watchlist_manager.py`. No more CLI-only features.

## Architecture

```
app/watchlist.py          ← new shared module (business logic)
    ↑ imported by
app/bot.py                ← new /wadd, /wremove, /wlist; /suggest rewritten
app/ui.py                 ← Watchlist page gains add/remove/suggest actions
scripts/watchlist_manager.py  ← DELETED
```

## 1. `app/watchlist.py` (new)

Single source of truth for all watchlist operations.

**Functions:**

| Function | Signature | Notes |
|---|---|---|
| `load_watchlist` | `() -> dict` | Reads `data/json/watchlist.json`, validates schema |
| `save_watchlist` | `(data: dict) -> None` | Atomic write via tempfile + os.replace |
| `add_ticker` | `(ticker: str, notes: str) -> dict` | Returns `{ok, message}`. Validates regex, checks mutual exclusion with portfolio |
| `remove_ticker` | `(ticker: str) -> dict` | Returns `{ok, message}`. Removes from user or ai_suggested |
| `all_tickers` | `(wl: dict) -> list[str]` | All tickers regardless of source |
| `suggest` | `(count: int) -> dict` | Returns `{ok, suggestions: list, message}`. Calls Ollama directly, saves ai_suggested |

**Dependencies:** `app/utils.py` (atomic write helper, validation), `app/db.py` (load portfolio tickers for exclusion check).

**Error handling:** All functions return `{ok: bool, message: str}` — never raise. Callers format for their medium (Telegram HTML vs Streamlit widget).

## 2. `app/bot.py` changes

### New commands

| Command | Args | Handler |
|---|---|---|
| `/wadd` | `TICKER [notes]` | `cmd_wadd` — calls `watchlist.add_ticker()` |
| `/wremove` | `TICKER` | `cmd_wremove` — calls `watchlist.remove_ticker()` |
| `/wlist` | none | `cmd_wlist` — calls `watchlist.load_watchlist()`, formats user + AI sections |

### Modified commands

- `/suggest [N]`: replace `subprocess.run(["python", "scripts/watchlist_manager.py", ...])` with `watchlist.suggest(count)`. Same Telegram response format.

### Registration

Add `/wadd`, `/wremove`, `/wlist` to `register_commands()` for Telegram autocomplete.

### Help text

Update `/help` to include the three new commands.

## 3. `app/ui.py` Watchlist page changes

Add a management panel below the existing read-only table:

```
─── Kelola Watchlist ───────────────────────────────
[ Tambah Ticker ]
  Ticker: [____]  Notes: [__________]  [➕ Tambah]

[ Hapus Ticker ]
  Pilih: [selectbox]  [🗑️ Hapus]

[ AI Saran ]
  Jumlah: [1-10]  [🤖 Minta Saran AI]  ← shows spinner during Ollama call
─────────────────────────────────────────────────────
```

All three actions call `app/watchlist.py` functions and `st.rerun()` on success.

## 3b. `app/ui.py` Dashboard page changes

Remove "Positions" from sidebar nav. Merge all Positions CRUD into the Dashboard page, below the summary metrics and P&L table:

```
─── Kelola Posisi ──────────────────────────────────
[ Edit existing — one expander per position ]
  BBCA — 57 lot @ Rp 8,674
    Avg Price: [____]  Lots: [____]  Notes: [____]
    [💾 Simpan]  [🗑️ Nonaktifkan]

[ Tambah Posisi Baru ]
  Ticker: [____]  Avg: [____]  Lots: [____]  Notes: [____]
  [➕ Tambah]
─────────────────────────────────────────────────────
```

The Positions page is removed from the sidebar radio entirely.

## 4. Deletion

`scripts/watchlist_manager.py` is deleted after bot and UI changes are verified.

## 5. Docs

- `CLAUDE.md`: update project structure (remove scripts section or note it's empty), update bot commands list, update "Running Locally" section
- `README.md`: same changes — remove script usage examples, add new bot commands, note UI watchlist management

## Out of Scope

- No change to watchlist.json schema
- No change to Docker/cron config
- No new tests (existing test_utils.py covers atomic write; watchlist logic is thin wrappers)
