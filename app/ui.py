#!/usr/bin/env python3
"""
ui.py — Streamlit dashboard for IDX Portfolio Analyzer
Run: streamlit run ui.py --server.port 8501
"""

import json
import os
import re
from datetime import datetime
import streamlit as st
import pandas as pd

from app.db import (init_db, get_all_positions, upsert_position, deactivate_position,
                    get_latest_snapshot, get_latest_analysis, get_all_latest_snapshots,
                    get_snapshots, get_analyses, sync_portfolio_json,
                    get_recommendation_accuracy)
from app.utils import fmt_idr, fmt_cap, pnl_icon, calc_pnl, to_wib, WIB, sanitize_html, get_version, get_version_url
from app import watchlist as wl_mod

PORTFOLIO_FILE = os.getenv("PORTFOLIO_FILE", "data/json/portfolio.json")
UI_PASSWORD = os.getenv("UI_PASSWORD", "")

init_db()

st.set_page_config(page_title="IDX Portfolio", page_icon="📈", layout="wide")

# ── Auth ─────────────────────────────────────────────────────────────────────
if UI_PASSWORD:
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False

    if not st.session_state.authenticated:
        st.title("🔒 Login Required")
        pwd = st.text_input("Password", type="password")
        if st.button("Login"):
            if pwd == UI_PASSWORD:
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Password salah.")
        st.stop()

# ── Sidebar ───────────────────────────────────────────────────────────────────
st.sidebar.title("📈 IDX Portfolio")
st.sidebar.caption(f"[v {get_version()}]({get_version_url()})")
page = st.sidebar.radio("Navigation", ["Dashboard", "Watchlist", "Positions", "History", "Analysis Log", "Accuracy"])

# ── Helpers ───────────────────────────────────────────────────────────────────
def ts_wib(dt):
    if dt is None: return "—"
    return to_wib(dt).strftime("%d %b %Y %H:%M")


# ── PAGE: Dashboard ───────────────────────────────────────────────────────────
if page == "Dashboard":
    st.title("📊 Portfolio Dashboard")

    snaps = get_all_latest_snapshots()
    positions = {p["ticker"]: p for p in get_all_positions()}

    if not snaps:
        st.info("Belum ada data. Jalankan fetch_portfolio.py terlebih dahulu.")
        st.stop()

    # Summary cards
    total_inv = total_pnl = 0
    rows = []
    for s in snaps:
        ticker = s["ticker"]
        pos    = positions.get(ticker, {})
        avg    = pos.get("avg_price") or s.get("avg_price") or 0
        lots   = pos.get("lots") or s.get("lots") or 0
        price  = s.get("current_price") or 0
        analysis = get_latest_analysis(ticker)
        rec    = (analysis.get("recommendation") or "—") if analysis else "—"

        if avg and lots and price:
            p = calc_pnl(price, avg, lots)
            total_inv  += p["invested"]
            total_pnl  += p["total_pnl"]
        else:
            p = {"pnl": 0, "pnl_pct": 0, "total_pnl": 0, "invested": 0}

        rows.append({
            "Ticker":       ticker,
            "Harga":        price,
            "Avg Beli":     avg,
            "Lots":         lots,
            "Invested":     p["invested"],
            "P&L/lembar":   p["pnl"],
            "P&L %":        p["pnl_pct"],
            "Total P&L":    p["total_pnl"],
            "Rekomendasi":  rec,
            "Update":       ts_wib(s.get("fetched_at")),
        })

    # Top summary
    col1, col2, col3 = st.columns(3)
    total_pct = (total_pnl / total_inv * 100) if total_inv else 0
    col1.metric("Total Investasi", fmt_cap(total_inv))
    col2.metric("Total P&L", fmt_cap(abs(total_pnl)),
                f"{'+' if total_pnl >= 0 else ''}{total_pct:.2f}%",
                delta_color="normal" if total_pnl >= 0 else "inverse")
    col3.metric("Jumlah Posisi", len(rows))

    st.divider()

    # Table
    df = pd.DataFrame(rows)
    if not df.empty:
        def color_pnl(val):
            """Return CSS color for numeric P&L values."""
            if val is None or val == 0:
                return ""
            return "color: #22c55e" if val > 0 else "color: #ef4444"

        idr_cols = ["Harga", "Avg Beli", "Invested", "P&L/lembar", "Total P&L"]
        pnl_cols = ["P&L/lembar", "P&L %", "Total P&L"]

        styled = (
            df.style
            .format({
                "Harga":      lambda x: fmt_idr(x),
                "Avg Beli":   lambda x: fmt_idr(x, 2),
                "Invested":   lambda x: fmt_cap(x),
                "P&L/lembar": lambda x: fmt_idr(x) if x else "—",
                "Total P&L":  lambda x: f"Rp {x:+,.0f}" if x else "—",
                "P&L %":      lambda x: f"{x:+.2f}%" if x else "—",
                "Lots":       lambda x: f"{x:,}",
            })
            .map(color_pnl, subset=pnl_cols)
            .set_properties(subset=idr_cols, **{"text-align": "right"})
            .set_properties(subset=["Lots"], **{"text-align": "right"})
            .set_properties(subset=["P&L %"], **{"text-align": "right"})
        )

        st.dataframe(styled, use_container_width=True, hide_index=True)

        # P&L bar chart
        st.subheader("Total P&L per Saham")
        chart_df = df[["Ticker", "Total P&L"]].set_index("Ticker")
        st.bar_chart(chart_df)


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
            if "BUY"     in str(val): return "color: #22c55e"
            if "HINDARI" in str(val): return "color: #ef4444"
            if "TUNGGU"  in str(val): return "color: #eab308"
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


# ── PAGE: Positions (CRUD) ────────────────────────────────────────────────────
elif page == "Positions":
    st.title("🗂️ Manage Positions")

    positions = get_all_positions()

    # Edit existing
    st.subheader("Posisi Aktif")
    if positions:
        for pos in positions:
            with st.expander(f"**{pos['ticker']}** — {pos['lots']} lot @ {fmt_idr(pos['avg_price'], 2)}"):
                col1, col2, col3 = st.columns(3)
                new_avg  = col1.number_input("Avg Price (Rp)", value=float(pos["avg_price"]),
                                              step=1.0, key=f"avg_{pos['ticker']}")
                new_lots = col2.number_input("Lots", value=int(pos["lots"]),
                                              step=1, key=f"lots_{pos['ticker']}")
                new_notes= col3.text_input("Notes", value=pos.get("notes",""),
                                            key=f"notes_{pos['ticker']}")
                c1, c2 = st.columns([1, 4])
                if c1.button("💾 Simpan", key=f"save_{pos['ticker']}"):
                    upsert_position(pos["ticker"], new_avg, new_lots, new_notes)
                    sync_portfolio_json(PORTFOLIO_FILE)
                    st.success(f"✅ {pos['ticker']} diperbarui.")
                    st.rerun()
                if c2.button("🗑️ Nonaktifkan", key=f"del_{pos['ticker']}"):
                    deactivate_position(pos["ticker"])
                    sync_portfolio_json(PORTFOLIO_FILE)
                    st.warning(f"⚠️ {pos['ticker']} dinonaktifkan.")
                    st.rerun()
    else:
        st.info("Belum ada posisi aktif.")

    st.divider()

    # Add new
    st.subheader("➕ Tambah Posisi Baru")
    col1, col2, col3, col4 = st.columns(4)
    new_ticker = col1.text_input("Ticker", placeholder="BBCA").upper()
    new_avg    = col2.number_input("Avg Price (Rp)", min_value=0.0, step=1.0)
    new_lots   = col3.number_input("Lots", min_value=0, step=1)
    new_notes  = col4.text_input("Notes", placeholder="Optional")

    if st.button("➕ Tambah"):
        if not new_ticker or not re.match(r"^[A-Z0-9]{1,10}$", new_ticker):
            st.error("Ticker tidak valid (1-10 huruf/angka).")
        elif new_avg <= 0 or new_lots <= 0:
            st.error("Avg Price dan Lots harus > 0.")
        else:
            upsert_position(new_ticker, new_avg, new_lots, new_notes)
            sync_portfolio_json(PORTFOLIO_FILE)
            st.success(f"✅ {new_ticker} ditambahkan.")
            st.rerun()


# ── PAGE: History ─────────────────────────────────────────────────────────────
elif page == "History":
    st.title("📅 Price History")

    positions = get_all_positions()
    if not positions:
        st.info("Belum ada posisi."); st.stop()

    ticker = st.selectbox("Pilih Saham", [p["ticker"] for p in positions])
    limit  = st.slider("Jumlah data", 10, 100, 30)

    snaps = get_snapshots(ticker, limit=limit)
    if not snaps:
        st.info(f"Belum ada data historis untuk {ticker}."); st.stop()

    df = pd.DataFrame(snaps)
    df["fetched_at"] = pd.to_datetime(df["fetched_at"]).dt.tz_localize("UTC").dt.tz_convert("Asia/Jakarta")
    df = df.sort_values("fetched_at")

    col1, col2 = st.columns(2)

    with col1:
        st.subheader("Harga Penutupan")
        st.line_chart(df.set_index("fetched_at")[["current_price"]])

    with col2:
        st.subheader("Total P&L (Rp)")
        if "total_pnl" in df.columns:
            st.line_chart(df.set_index("fetched_at")[["total_pnl"]])
        else:
            st.info("Kolom total_pnl belum tersedia.")

    st.subheader("Raw Data")
    cols = ["fetched_at", "current_price", "day_change_pct", "total_pnl",
            "unrealized_pnl_pct", "volume", "pe", "pb"]
    st.dataframe(df[[c for c in cols if c in df.columns]], use_container_width=True, hide_index=True)


# ── PAGE: Analysis Log ────────────────────────────────────────────────────────
elif page == "Analysis Log":
    st.title("🤖 Analysis Log")

    positions = get_all_positions()
    if not positions:
        st.info("Belum ada posisi."); st.stop()

    ticker = st.selectbox("Pilih Saham", [p["ticker"] for p in positions])
    limit  = st.slider("Jumlah data", 5, 50, 20)

    analyses = get_analyses(ticker, limit=limit)
    if not analyses:
        st.info(f"Belum ada analisis untuk {ticker}."); st.stop()

    for a in analyses:
        ts  = ts_wib(a.get("analysed_at"))
        rec = a.get("recommendation") or "—"
        sent = "✉️ Terkirim" if a.get("sent_telegram") else ("⏭️ Dilewati" if a.get("skipped_same") else "🔇 Tidak dikirim")
        with st.expander(f"**{ts}** | {rec} | {sent}"):
            st.markdown(sanitize_html(a.get("clean_html", "—")), unsafe_allow_html=True)
            if st.toggle("Lihat raw output", key=f"raw_{a['id']}"):
                st.code(a.get("raw_output", ""), language="html")


# ── PAGE: Accuracy ────────────────────────────────────────────────────────────
elif page == "Accuracy":
    st.title("📊 Recommendation Accuracy")

    days = st.slider("Evaluasi setelah N hari", 1, 14, 3)
    results = get_recommendation_accuracy(days_after=days)

    if not results:
        st.info("Belum cukup data historis untuk evaluasi akurasi.")
        st.stop()

    correct_count = sum(1 for r in results if r["correct"] is True)
    total = sum(1 for r in results if r["correct"] is not None)
    accuracy = (correct_count / total * 100) if total else 0

    col1, col2, col3 = st.columns(3)
    col1.metric("Akurasi", f"{accuracy:.0f}%")
    col2.metric("Benar", f"{correct_count}/{total}")
    col3.metric("Total Evaluasi", len(results))

    st.divider()

    df = pd.DataFrame(results)
    df["analysed_at"] = df["analysed_at"].apply(ts_wib)
    df["correct"] = df["correct"].apply(lambda x: "✅" if x else ("❌" if x is False else "❓"))
    st.dataframe(df[["ticker", "recommendation", "analysed_at", "price_at_rec",
                      "price_after", "actual_change_pct", "correct"]],
                 use_container_width=True, hide_index=True)