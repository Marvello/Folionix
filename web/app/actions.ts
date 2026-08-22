"use server";

import { getPool } from "@/lib/db";

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
  const pool = getPool();
  const now = new Date().toISOString();
  if (id == null) {
    await pool.query(
      `INSERT INTO bond_holdings (series_type, series_code, platform, principal, purchase_price, coupon_rate, maturity_date, purchased_at, updated_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [payload.series_type, payload.series_code, payload.platform, payload.principal, payload.purchase_price, payload.coupon_rate, payload.maturity_date, payload.purchased_at, now, payload.notes],
    );
  } else {
    await pool.query(
      `UPDATE bond_holdings SET series_type=$1, series_code=$2, platform=$3, principal=$4, purchase_price=$5, coupon_rate=$6, maturity_date=$7, purchased_at=$8, updated_at=$9, notes=$10 WHERE id=$11`,
      [payload.series_type, payload.series_code, payload.platform, payload.principal, payload.purchase_price, payload.coupon_rate, payload.maturity_date, payload.purchased_at, now, payload.notes, id],
    );
  }
}

export async function deactivateBondHolding(id: number) {
  await getPool().query(
    `UPDATE bond_holdings SET active = false, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), id],
  );
}

export async function insertBondCouponPayments(
  rows: { bond_holding_id: number; amount: number; paid_at: string; notes: string }[],
) {
  const pool = getPool();
  const now = new Date().toISOString();
  for (const r of rows) {
    await pool.query(
      `INSERT INTO bond_coupon_payments (bond_holding_id, amount, paid_at, notes, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [r.bond_holding_id, r.amount, r.paid_at, r.notes, now],
    );
  }
}

// ── Portfolio / Stocks ──

export async function insertPriceRefreshRequest(kind?: string) {
  await getPool().query(
    `INSERT INTO price_refresh_requests (kind) VALUES ($1)`,
    [kind ?? null],
  );
}

export async function pollLatestSnapshotTime(): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT fetched_at FROM latest_snapshots ORDER BY fetched_at DESC LIMIT 1`,
  );
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
  await getPool().query(
    `INSERT INTO stock_transactions (ticker, side, lots, price, fee, txn_at, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [payload.ticker, payload.side, payload.lots, payload.price, payload.fee, payload.txn_at, payload.notes],
  );
}

export async function insertStockDividend(payload: {
  ticker: string;
  amount: number;
  per_share: number | null;
  paid_at: string;
  notes: string;
}) {
  await getPool().query(
    `INSERT INTO stock_dividends (ticker, amount, per_share, paid_at, notes) VALUES ($1, $2, $3, $4, $5)`,
    [payload.ticker, payload.amount, payload.per_share, payload.paid_at, payload.notes],
  );
}

export async function deactivatePosition(ticker: string) {
  await getPool().query(
    `UPDATE portfolio_positions SET active = false, updated_at = $1 WHERE ticker = $2`,
    [new Date().toISOString(), ticker],
  );
}

// ── Account Charges ──

export async function insertAccountCharge(payload: {
  charged_at: string;
  type: string;
  amount: number;
  notes: string;
}) {
  await getPool().query(
    `INSERT INTO account_charges (charged_at, type, amount, notes) VALUES ($1, $2, $3, $4)`,
    [payload.charged_at, payload.type, payload.amount, payload.notes],
  );
}

export async function deleteAccountCharge(id: number) {
  await getPool().query(`DELETE FROM account_charges WHERE id = $1`, [id]);
}

// ── Watchlist ──

export async function upsertWatchlistItem(ticker: string, notes: string) {
  await getPool().query(
    `INSERT INTO watchlist (ticker, kind, notes, added_at) VALUES ($1, 'user', $2, $3)
     ON CONFLICT (ticker) DO UPDATE SET notes = $2, added_at = $3`,
    [ticker, notes, new Date().toISOString()],
  );
}

export async function deleteWatchlistItem(ticker: string) {
  await getPool().query(`DELETE FROM watchlist WHERE ticker = $1`, [ticker.toUpperCase()]);
}

// ── News ──

export async function fetchFilteredNews(
  filter: string,
  limit: number,
  cutoffIso: string,
) {
  const pool = getPool();
  let sql = `SELECT * FROM news_cache WHERE published_at >= $1`;
  const params: unknown[] = [cutoffIso];

  if (filter === "Macro") {
    sql += ` AND ticker IS NULL`;
  } else if (filter !== "All") {
    sql += ` AND ticker = $2`;
    params.push(filter);
  }

  sql += ` ORDER BY published_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(sql, params);
  return rows;
}

// ── Gold ──

export async function pollLatestGoldPriceTime(): Promise<string | null> {
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
  const now = new Date().toISOString();
  await getPool().query(
    `INSERT INTO gold_purchases (venue, grams, buy_price_per_gram, purchased_at, updated_at, notes, side) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [payload.venue, payload.grams, payload.buy_price_per_gram, payload.purchased_at, now, payload.notes, payload.side ?? "BUY"],
  );
}

export async function updateGoldPurchase(
  id: number,
  payload: { grams: number; buy_price_per_gram: number; notes: string; purchased_at: string },
) {
  await getPool().query(
    `UPDATE gold_purchases SET grams=$1, buy_price_per_gram=$2, notes=$3, purchased_at=$4, updated_at=$5 WHERE id=$6`,
    [payload.grams, payload.buy_price_per_gram, payload.notes, payload.purchased_at, new Date().toISOString(), id],
  );
}

export async function deactivateGoldPurchase(id: number) {
  await getPool().query(
    `UPDATE gold_purchases SET active = false, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), id],
  );
}

// ── Funds ──

export async function pollLatestFundNavTime(): Promise<string | null> {
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
  const now = new Date().toISOString();
  await getPool().query(
    `INSERT INTO fund_purchases (fund_code, fund_name, platform, currency, units, buy_nav_per_unit, purchased_at, updated_at, notes, side)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [payload.fund_code, payload.fund_name, payload.platform, payload.currency, payload.units, payload.buy_nav_per_unit, payload.purchased_at, now, payload.notes, payload.side ?? "BUY"],
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
  await getPool().query(
    `UPDATE fund_purchases SET platform=$1, currency=$2, units=$3, buy_nav_per_unit=$4, notes=$5, purchased_at=$6, updated_at=$7 WHERE id=$8`,
    [payload.platform, payload.currency, payload.units, payload.buy_nav_per_unit, payload.notes, payload.purchased_at, new Date().toISOString(), id],
  );
}

export async function deactivateFundPurchase(id: number) {
  await getPool().query(
    `UPDATE fund_purchases SET active = false, updated_at = $1 WHERE id = $2`,
    [new Date().toISOString(), id],
  );
}

export async function insertFundDistribution(payload: {
  fund_code: string;
  amount: number;
  paid_at: string;
  notes: string;
}) {
  await getPool().query(
    `INSERT INTO fund_distributions (fund_code, amount, paid_at, notes) VALUES ($1, $2, $3, $4)`,
    [payload.fund_code, payload.amount, payload.paid_at, payload.notes],
  );
}
