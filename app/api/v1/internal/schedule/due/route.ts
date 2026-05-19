import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/schedule/due
 *
 * Returns all ScheduleEntry rows whose `publishAt` is in the past and
 * `postedAt` is still null — i.e. due for publishing. Cross-app cron
 * (Multiplier's `publish-due`) uses this to pull the work queue without
 * needing a Clerk session.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 *
 * Body (optional):
 *   { limit?: number, staleSecPast?: number }
 *     - limit: max rows to return (default 50, max 200)
 *     - staleSecPast: skip rows older than this many seconds past due
 *       (default: 14 days). Matches the Multiplier's existing stale filter.
 */
export async function POST(request: Request) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  let body: { limit?: number; staleSecPast?: number };
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    body = {};
  }

  const limit =
    typeof body.limit === "number" && body.limit > 0
      ? Math.min(body.limit, 200)
      : 50;
  const staleSecPast =
    typeof body.staleSecPast === "number" && body.staleSecPast > 0
      ? body.staleSecPast
      : 14 * 24 * 60 * 60;

  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleSecPast * 1000);

  const rows = await prisma.scheduleEntry.findMany({
    where: {
      postedAt: null,
      publishAt: { lte: now, gte: staleBefore },
    },
    orderBy: { publishAt: "asc" },
    take: limit,
  });

  return NextResponse.json({ data: rows });
}
