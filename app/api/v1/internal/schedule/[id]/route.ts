import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/internal/schedule/[id]
 *
 * Single ScheduleEntry fetch by id, for cross-app crons / on-demand
 * publishers (e.g. Multiplier's `publish-now`). Bearer auth, no Clerk.
 */
type ParamsCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: ParamsCtx) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  const { id } = await ctx.params;
  const row = await prisma.scheduleEntry.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json(
      {
        type: "/errors/scheduleentry-not-found",
        title: "ScheduleEntry not found",
        status: 404,
        detail: `ScheduleEntry with id ${id} does not exist`,
      },
      {
        status: 404,
        headers: { "Content-Type": "application/problem+json" },
      },
    );
  }
  return NextResponse.json({ data: row });
}
