import { NextResponse } from "next/server";

/**
 * Shared-secret auth for `/api/v1/internal/*` routes. Used by cross-app
 * crons (e.g. Multiplier's publish-due) that can't carry a Clerk session.
 *
 * Returns `null` if authorized, otherwise a NextResponse to return early.
 * Mirrors the pattern of `lib/auth/require-user.ts` for Clerk-gated routes.
 *
 * Env var `SCHEDULE_DAEMON_SECRET` must match the value used by the calling
 * Multiplier — the Multiplier already has this set; Hub needs the same
 * value added in Coolify env.
 */
export function denyIfNotInternalAuthorized(
  request: Request,
): NextResponse | null {
  const secret = process.env.SCHEDULE_DAEMON_SECRET?.trim();
  if (!secret || secret.length === 0) {
    return NextResponse.json(
      {
        type: "/errors/internal-misconfigured",
        title: "Internal endpoint misconfigured",
        status: 503,
        detail:
          "SCHEDULE_DAEMON_SECRET is not set on the Hub. Add it (same value as the Multiplier's secret) in Coolify env.",
      },
      {
        status: 503,
        headers: { "Content-Type": "application/problem+json" },
      },
    );
  }
  const h = request.headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1]!.trim() : "";
  if (token !== secret) {
    return NextResponse.json(
      {
        type: "/errors/unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid or missing shared-secret bearer token.",
      },
      {
        status: 401,
        headers: { "Content-Type": "application/problem+json" },
      },
    );
  }
  return null;
}
