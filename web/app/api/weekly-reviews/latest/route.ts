import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { WeeklyReview } from "@/lib/types";

// Read-only endpoint for the local /aireview loop. The DB is not reachable
// from a developer machine, so the deployed web app (which holds the pg pool)
// proxies the latest weekly review behind a static bearer token.
export const dynamic = "force-dynamic";

// Constant-time compare; hashing first equalizes lengths so length isn't leaked either.
function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request): Promise<NextResponse> {
  const expected = process.env["AIREVIEW_API_TOKEN"];
  if (!expected) {
    // Fail closed: never expose data when the token is unconfigured.
    return NextResponse.json({ error: "endpoint disabled" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(token, expected)) return unauthorized();

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, week_start, week_end, report_md, handover_md, stats, model
       FROM weekly_reviews
      ORDER BY week_end DESC, id DESC
      LIMIT 1`,
  );
  const review = (rows[0] ?? null) as Partial<WeeklyReview> | null;
  return NextResponse.json({ review });
}
