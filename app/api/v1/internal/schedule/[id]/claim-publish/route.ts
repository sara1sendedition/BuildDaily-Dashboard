import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/** Stale claims can be stolen so a crashed publisher does not block forever. */
const CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * POST /api/v1/internal/schedule/[id]/claim-publish
 *
 * Soft-locks a schedule row for publishing via `publishClaimedAt` without
 * setting `postedAt`. Only one publisher can hold a fresh claim.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 */
type ParamsCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: ParamsCtx) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  const { id } = await ctx.params;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);

  const updated = await prisma.scheduleEntry.updateMany({
    where: {
      id,
      postedAt: null,
      OR: [
        { publishClaimedAt: null },
        { publishClaimedAt: { lt: staleBefore } },
      ],
    },
    data: { publishClaimedAt: now, error: null },
  });

  return NextResponse.json({
    data: {
      claimed: updated.count > 0,
      publishClaimedAt: updated.count > 0 ? now.toISOString() : null,
    },
  });
}
