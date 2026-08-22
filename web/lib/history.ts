import type pg from "pg";

const MAX_POINTS = 40;

export async function priceHistory(
  pool: pg.Pool,
  tickers: string[],
): Promise<Record<string, number[]>> {
  const map: Record<string, number[]> = {};
  if (tickers.length === 0) return map;

  const { rows } = await pool.query(
    `SELECT ticker, current_price, fetched_at
     FROM stock_snapshots
     WHERE ticker = ANY($1)
     ORDER BY fetched_at DESC
     LIMIT 3000`,
    [tickers],
  );

  for (const r of rows as { ticker: string; current_price: number | null }[]) {
    if (r.current_price == null) continue;
    const k = r.ticker.toUpperCase();
    (map[k] ??= []);
    if (map[k].length < MAX_POINTS) map[k].push(r.current_price);
  }
  for (const k in map) map[k].reverse();
  return map;
}
