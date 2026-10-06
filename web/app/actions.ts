"use server";

import { getPool } from "@/lib/db";
import { auth } from "@/lib/auth";

// ── Guards ──
// Every action is a public POST endpoint: proxy.ts is not a security boundary for
// Server Actions, so each one checks the session and validates its own input.
// Text lengths mirror the varchar widths in db/schema.sql.

async function requireSession() {
  if (!(await auth())) throw new Error("Unauthorized");
}

const TICKER_RE = /^(?:\^JKSE|[A-Z0-9]{1,7}\.JK)$/;
const NEWS_LIMIT_MAX = 200;

function vTicker(v: unknown): string {
  if (typeof v !== "string" || !TICKER_RE.test(v)) throw new Error("Invalid ticker");
  return v;
}

/** Finite number > 0 (or >= 0 with `zero`), optionally a whole number. */
function vNum(v: unknown, name: string, { zero = false, int = false } = {}): number {
  const ok =
    typeof v === "number" && Number.isFinite(v) && (zero ? v >= 0 : v > 0) && (!int || Number.isInteger(v));
  if (!ok) throw new Error(`Invalid ${name}`);
  return v as number;
}

function vOptNum(v: unknown, name: string): number | null {
  return v == null ? null : vNum(v, name);
}

function vId(v: unknown): number {
  return vNum(v, "id", { int: true });
}

function vDate(v: unknown, name: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new Error(`Invalid ${name}`);
  return v;
}

function vOptDate(v: unknown, name: string): string | null {
  return v == null || v === "" ? null : vDate(v, name);
}

function vText(v: unknown, max = 1000): string {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > max) throw new Error("Invalid text");
  return v;
}

function vSide(v: unknown): "BUY" | "SELL" {
  const s = v ?? "BUY";
  if (s !== "BUY" && s !== "SELL") throw new Error("Invalid side");
  return s;
}

// ── Bonds ──

export async function saveBondHolding(
  id: number | null,
  payload: {
    series_type: string;
    series_code: string;
    platform: string;
    principal: number;
    purchase_price: number | null;
    coupon_rate: number | null;
    maturity_date: string | null;
    purchased_at: string;
    notes: string;
  },
) {
  await requireSession();
  const params = [
    vText(payload.series_type, 8),
    vText(payload.series_code, 40),
    vText(payload.platform, 30),
    vNum(payload.principal, "principal"),
    vOptNum(payload.purchase_price, "purchase price"),
    vOptNum(payload.coupon_rate, "coupon rate"),
    vOptDate(payload.maturity_date, "maturity date"),
    vDate(payload.purchased_at, "purchase date"),
    new Date().toISOString(),
    vText(payload.notes),
  ];
  const pool = getPool();
  if (id == null) {
    await pool.query(
      `INSERT INTO bond_holdings (series_type, series_code, platform, principal, purchase_price, coupon_rate, maturity_date, purchased_at, updated_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      params,
    );
  } else {
    await pool.query(
      `UPDATE bond_holdings SET series_type=$1, series_code=$2, platform=$3, principal=$4, purchase_price=$5, coupon_rate=$6, maturity_date=$7, purchased_at=$8, updated_at=$9, notes=$10 WHERE id=$11`,
      [...params, vId(id)],
    );
  }
}

export async function deactivateBondHolding(id: number) {
  await requireSession();
  await getPool().query(
    `UPDATE bond_holdings SET active = false, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), vId(id)],
  );
}

export async function insertBondCouponPayments(
  rows: { bond_holding_id: number; amount: number; paid_at: string; notes: string }[],
) {
  await requireSession();
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("Invalid rows");
  const valid = rows.map((r) => [vId(r.bond_holding_id), vNum(r.amount, "amount"), vDate(r.paid_at, "paid date"), vText(r.notes)]);
  const pool = getPool();
  const now = new Date().toISOString();
  for (const [holdingId, amount, paidAt, notes] of valid) {
    await pool.query(
      `INSERT INTO bond_coupon_payments (bond_holding_id, amount, paid_at, notes, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [holdingId, amount, paidAt, notes, now],
    );
  }
}

// ── Portfolio / Stocks ──

export async function insertPriceRefreshRequest(kind: "stock" | "gold" | "fund" = "stock") {
  await requireSession();
  if (kind !== "stock" && kind !== "gold" && kind !== "fund") throw new Error("Invalid kind");
  // kind is NOT NULL (default 'stock'); an explicit NULL used to fail the stock refresh.
  await getPool().query(`INSERT INTO price_refresh_requests (kind) VALUES ($1)`, [kind]);
}

export async function pollLatestSnapshotTime(): Promise<string | null> {
  await requireSession();
  const { rows } = await getPool().query(`SELECT max(fetched_at) AS fetched_at FROM stock_snapshots`);
  return rows[0]?.fetched_at ?? null;
}

export async function insertStockTransaction(payload: {
  ticker: string;
  side: string;
  lots: number;
  price: number;
  fee: number;
  txn_at: string;
  notes: string;
}) {
  await requireSession();
  const ticker = vTicker(payload.ticker);
  const side = vSide(payload.side);
  const lots = vNum(payload.lots, "lots", { int: true });
  const pool = getPool();
  if (side === "SELL") {
    const { rows } = await pool.query(`SELECT lots FROM portfolio_positions WHERE ticker = $1`, [ticker]);
    const held = rows[0]?.lots ?? 0;
    if (lots > held) throw new Error(`Cannot sell ${lots} lots; only ${held} held`);
  }
  await pool.query(
    `INSERT INTO stock_transactions (ticker, side, lots, price, fee, txn_at, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ticker, side, lots, vNum(payload.price, "price", { zero: true }), vNum(payload.fee, "fee", { zero: true }), vDate(payload.txn_at, "date"), vText(payload.notes)],
  );
}

export async function insertStockDividend(payload: {
  ticker: string;
  amount: number;
  per_share: number | null;
  paid_at: string;
  notes: string;
}) {
  await requireSession();
  await getPool().query(
    `INSERT INTO stock_dividends (ticker, amount, per_share, paid_at, notes) VALUES ($1, $2, $3, $4, $5)`,
    [vTicker(payload.ticker), vNum(payload.amount, "amount"), vOptNum(payload.per_share, "per share"), vDate(payload.paid_at, "paid date"), vText(payload.notes)],
  );
}

/** Hide a position. Not a ledger write: the recompute trigger re-shows it on the next transaction. */
export async function deactivatePosition(ticker: string) {
  await requireSession();
  await getPool().query(
    `UPDATE portfolio_positions SET active = false, updated_at = $1 WHERE ticker = $2`,
    [new Date().toISOString(), vTicker(ticker)],
  );
}

// ── Account Charges ──

export async function insertAccountCharge(payload: {
  charged_at: string;
  type: string;
  amount: number;
  notes: string;
}) {
  await requireSession();
  await getPool().query(
    `INSERT INTO account_charges (charged_at, type, amount, notes) VALUES ($1, $2, $3, $4)`,
    [vDate(payload.charged_at, "date"), vText(payload.type, 40), vNum(payload.amount, "amount"), vText(payload.notes)],
  );
}

export async function deleteAccountCharge(id: number) {
  await requireSession();
  await getPool().query(`DELETE FROM account_charges WHERE id = $1`, [vId(id)]);
}

// ── Watchlist ──

export async function upsertWatchlistItem(ticker: string, notes: string) {
  await requireSession();
  await getPool().query(
    `INSERT INTO watchlist (ticker, kind, notes, added_at) VALUES ($1, 'user', $2, $3)
     ON CONFLICT (ticker) DO UPDATE SET notes = $2, added_at = $3`,
    [vTicker(ticker), vText(notes), new Date().toISOString()],
  );
}

/** Turn an auto-added peer row into a user entry; the weekly peer refresh never touches `user` rows. */
export async function promotePeer(ticker: string) {
  await requireSession();
  await getPool().query(`UPDATE watchlist SET kind = 'user' WHERE ticker = $1 AND kind = 'peer'`, [vTicker(ticker)]);
}

export async function deleteWatchlistItem(ticker: string) {
  await requireSession();
  await getPool().query(`DELETE FROM watchlist WHERE ticker = $1`, [vTicker(String(ticker).toUpperCase())]);
}

// ── News ──

export async function fetchFilteredNews(
  filter: string,
  limit: number,
  cutoffIso: string,
) {
  await requireSession();
  const pool = getPool();
  let sql = `SELECT * FROM news_cache WHERE published_at >= $1`;
  const params: unknown[] = [vDate(cutoffIso, "cutoff")];

  if (filter === "Macro") {
    sql += ` AND ticker IS NULL`;
  } else if (filter !== "All") {
    sql += ` AND ticker = $2`;
    params.push(vTicker(filter));
  }

  sql += ` ORDER BY published_at DESC LIMIT $${params.length + 1}`;
  params.push(Math.min(vNum(limit, "limit", { int: true }), NEWS_LIMIT_MAX));

  const { rows } = await pool.query(sql, params);
  return rows;
}

// ── Gold ──

export async function pollLatestGoldPriceTime(): Promise<string | null> {
  await requireSession();
  const { rows } = await getPool().query(
    `SELECT fetched_at FROM latest_gold_prices ORDER BY fetched_at DESC LIMIT 1`,
  );
  return rows[0]?.fetched_at ?? null;
}

export async function insertGoldPurchase(payload: {
  venue: string;
  grams: number;
  buy_price_per_gram: number;
  purchased_at: string;
  notes: string;
  side?: string;
}) {
  await requireSession();
  const now = new Date().toISOString();
  await getPool().query(
    `INSERT INTO gold_purchases (venue, grams, buy_price_per_gram, purchased_at, updated_at, notes, side) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [vText(payload.venue, 30), vNum(payload.grams, "grams"), vNum(payload.buy_price_per_gram, "price"), vDate(payload.purchased_at, "date"), now, vText(payload.notes), vSide(payload.side)],
  );
}

export async function updateGoldPurchase(
  id: number,
  payload: { grams: number; buy_price_per_gram: number; notes: string; purchased_at: string },
) {
  await requireSession();
  await getPool().query(
    `UPDATE gold_purchases SET grams=$1, buy_price_per_gram=$2, notes=$3, purchased_at=$4, updated_at=$5 WHERE id=$6`,
    [vNum(payload.grams, "grams"), vNum(payload.buy_price_per_gram, "price"), vText(payload.notes), vDate(payload.purchased_at, "date"), new Date().toISOString(), vId(id)],
  );
}

export async function deactivateGoldPurchase(id: number) {
  await requireSession();
  await getPool().query(
    `UPDATE gold_purchases SET active = false, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), vId(id)],
  );
}

// ── Funds ──

export async function pollLatestFundNavTime(): Promise<string | null> {
  await requireSession();
  const { rows } = await getPool().query(
    `SELECT fetched_at FROM latest_fund_navs ORDER BY fetched_at DESC LIMIT 1`,
  );
  return rows[0]?.fetched_at ?? null;
}

export async function insertFundPurchase(payload: {
  fund_code: string;
  fund_name: string;
  platform: string;
  currency: string;
  units: number;
  buy_nav_per_unit: number;
  purchased_at: string;
  notes: string;
  side?: string;
}) {
  await requireSession();
  const now = new Date().toISOString();
  await getPool().query(
    `INSERT INTO fund_purchases (fund_code, fund_name, platform, currency, units, buy_nav_per_unit, purchased_at, updated_at, notes, side)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      vText(payload.fund_code, 40), vText(payload.fund_name, 300), vText(payload.platform, 30), vText(payload.currency, 5),
      vNum(payload.units, "units"), vNum(payload.buy_nav_per_unit, "NAV"), vDate(payload.purchased_at, "date"), now,
      vText(payload.notes), vSide(payload.side),
    ],
  );
}

export async function updateFundPurchase(
  id: number,
  payload: {
    platform: string;
    currency: string;
    units: number;
    buy_nav_per_unit: number;
    notes: string;
    purchased_at: string;
  },
) {
  await requireSession();
  await getPool().query(
    `UPDATE fund_purchases SET platform=$1, currency=$2, units=$3, buy_nav_per_unit=$4, notes=$5, purchased_at=$6, updated_at=$7 WHERE id=$8`,
    [
      vText(payload.platform, 30), vText(payload.currency, 5), vNum(payload.units, "units"), vNum(payload.buy_nav_per_unit, "NAV"),
      vText(payload.notes), vDate(payload.purchased_at, "date"), new Date().toISOString(), vId(id),
    ],
  );
}

export async function deactivateFundPurchase(id: number) {
  await requireSession();
  await getPool().query(
    `UPDATE fund_purchases SET active = false, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), vId(id)],
  );
}

export async function insertFundDistribution(payload: {
  fund_code: string;
  amount: number;
  paid_at: string;
  notes: string;
}) {
  await requireSession();
  await getPool().query(
    `INSERT INTO fund_distributions (fund_code, amount, paid_at, notes) VALUES ($1, $2, $3, $4)`,
    [vText(payload.fund_code, 40), vNum(payload.amount, "amount"), vDate(payload.paid_at, "paid date"), vText(payload.notes)],
  );
}
