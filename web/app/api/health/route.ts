import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

// Liveness + DB reachability for probes / uptime checks. Public, reveals nothing.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
