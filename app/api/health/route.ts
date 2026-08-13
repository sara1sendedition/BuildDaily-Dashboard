import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Liveness probe for Coolify / load balancers (no auth). */
export function GET() {
  return NextResponse.json({ ok: true });
}
