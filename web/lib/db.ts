import { createPool } from "@marvello/common-tech/client";
import pg from "pg";

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
