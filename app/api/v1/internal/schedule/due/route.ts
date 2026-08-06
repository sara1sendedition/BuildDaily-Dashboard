import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/** Match claim-publish stale window so crashed publishers can be retried. */
const CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * POST /api/v1/internal/schedule/due
 *
 * Returns ScheduleEntry rows that are past due, not successfully posted, and
 * not held by a fresh publish claim.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 *
 * Body (optional):
 *   { limit?: number, staleSecPast?: number }
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
  const claimStaleBefore = new Date(now.getTime() - CLAIM_STALE_MS);

  const rows = await prisma.scheduleEntry.findMany({
    where: {
      postedAt: null,
      publishAt: { lte: now, gte: staleBefore },
      OR: [
        { publishClaimedAt: null },
        { publishClaimedAt: { lt: claimStaleBefore } },
      ],
    },
    orderBy: { publishAt: "asc" },
    take: limit,
  });

  return NextResponse.json({ data: rows });
}
