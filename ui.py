#!/usr/bin/env python3
"""
ui.py — Streamlit dashboard for IDX Portfolio Analyzer
Run: streamlit run ui.py --server.port 8501
"""

import os, sys, json
from datetime import datetime
import streamlit as st
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import (init_db, get_all_positions, upsert_position, deactivate_position,
                get_latest_snapshot, get_latest_analysis, get_all_latest_snapshots,
                get_snapshots, get_analyses, sync_portfolio_json,
                get_recommendation_accuracy)
from utils import fmt_idr, fmt_cap, pnl_icon, calc_pnl, to_wib, WIB, sanitize_html

PORTFOLIO_FILE = os.getenv("PORTFOLIO_FILE", "/app/portfolio.json")
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
page = st.sidebar.radio("Navigation", ["Dashboard", "Positions", "History", "Analysis Log", "Accuracy"])

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
        df_display = df.copy()
        df_display["Harga"]       = df_display["Harga"].apply(fmt_idr)
        df_display["Avg Beli"]    = df_display["Avg Beli"].apply(lambda x: fmt_idr(x, 2))
        df_display["Invested"]    = df_display["Invested"].apply(fmt_cap)
        df_display["P&L/lembar"]  = df_display["P&L/lembar"].apply(fmt_idr)
        df_display["Total P&L"]   = df_display["Total P&L"].apply(
            lambda x: f"Rp {x:+,.0f}" if x else "—")
        df_display["P&L %"]       = df_display["P&L %"].apply(
            lambda x: f"{x:+.2f}%" if x else "—")

        st.dataframe(df_display, use_container_width=True, hide_index=True)

        # P&L bar chart
        st.subheader("Total P&L per Saham")
        chart_df = df[["Ticker", "Total P&L"]].set_index("Ticker")
        st.bar_chart(chart_df)


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
        if new_ticker and new_avg > 0 and new_lots > 0:
            upsert_position(new_ticker, new_avg, new_lots, new_notes)
            sync_portfolio_json(PORTFOLIO_FILE)
            st.success(f"✅ {new_ticker} ditambahkan.")
            st.rerun()
        else:
            st.error("Ticker, Avg Price, dan Lots wajib diisi.")


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