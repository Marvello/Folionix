import { describe, it, expect } from "vitest";
import pg from "pg";
import "./db"; // registers the pool's type parsers as an import side effect

describe("web pool type parsers", () => {
  it("parses bigint (int8, OID 20) to a JS number so bigserial ids aren't strings", () => {
    // bigserial primary keys (bond_holdings.id, …) arrive as int8. Without this
    // parser they come back as strings and fail server actions that validate
    // ids with a strict typeof === 'number' check (vId).
    expect(pg.types.getTypeParser(20)("7")).toBe(7);
  });
});
