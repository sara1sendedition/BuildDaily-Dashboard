import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/schedule/[id]/claim-publish
 *
 * Atomically sets `postedAt` when it is still null so only one publisher
 * (cron tick, manual publish-now, etc.) can post a given schedule row.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 */
type ParamsCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: ParamsCtx) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  const { id } = await ctx.params;
  const now = new Date();

  const updated = await prisma.scheduleEntry.updateMany({
    where: { id, postedAt: null },
    data: { postedAt: now, error: null },
  });

  return NextResponse.json({
    data: {
      claimed: updated.count > 0,
      postedAt: updated.count > 0 ? now.toISOString() : null,
    },
  });
}
