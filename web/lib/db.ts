import pg from "pg";

// Shared Postgres client pattern — see github.com/Marvello/common-tech (README).
// Inlined instead of a shared package: ~4 lines, nothing to version across repos.
function createPool(config: pg.PoolConfig & { max?: number }): pg.Pool {
  return new pg.Pool({ ...config, max: config.max ?? 10 });
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
    _pool = createPool({ connectionString: url, max: 5 });
  }
  return _pool;
}
