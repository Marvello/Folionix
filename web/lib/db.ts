import pg from "pg";

// Shared Postgres client pattern — see common-tech/tech-standard/postgres-client.md.
// Inlined instead of a shared package: nothing to version across repos.
function createPool(config: pg.PoolConfig & { max?: number }): pg.Pool {
  const pool = new pg.Pool({
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    options: "-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
    ...config,
    max: config.max ?? 10,
  });
  // Without a listener, an idle client erroring (Postgres restart) crashes Node.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return pool;
}

// Return dates/timestamps as ISO strings (matching PostgREST behavior)
// so the rest of the codebase can .slice(), compare, and serialize them.
pg.types.setTypeParser(1082, (v: string) => v);   // date
pg.types.setTypeParser(1114, (v: string) => v);   // timestamp
pg.types.setTypeParser(1184, (v: string) => v);   // timestamptz
pg.types.setTypeParser(1700, (v: string) => parseFloat(v)); // numeric → number (ledger columns, migration 046)
// bigint (int8) → number: bigserial primary keys arrive as int8 and would
// otherwise be strings, which breaks server actions that validate ids with a
// strict typeof === 'number' check (vId). Ids are small serials — safe for Number.
pg.types.setTypeParser(20, (v: string) => Number(v));

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL required");
    _pool = createPool({ connectionString: url, max: 5, application_name: "folionix-web" });
  }
  return _pool;
}

/** BEGIN … COMMIT on one client; a failed ROLLBACK destroys the client instead of re-pooling it. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch((e: Error) => { broken = e; });
    throw err;
  } finally {
    client.release(broken);
  }
}
