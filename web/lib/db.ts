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

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL required");
    _pool = createPool({ connectionString: url, max: 5, application_name: "folionix-web" });
  }
  return _pool;
}
