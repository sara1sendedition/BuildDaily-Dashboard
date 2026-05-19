import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/schedule/[id]/mark-posted
 *
 * Used by the Multiplier's publish-due cron to record publish results.
 * Sets `postedAt` and clears any previous `error` on success, or sets
 * `error` only (leaving `postedAt` null) on failure so the next cron
 * tick can retry.
 *
 * Body (any subset):
 *   { postedAt?: ISO timestamp | null, error?: string | null }
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 */
type ParamsCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: ParamsCtx) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  const { id } = await ctx.params;

  let body: { postedAt?: string | null; error?: string | null };
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if ("postedAt" in body) {
    const v = body.postedAt;
    if (v === null) data.postedAt = null;
    else if (typeof v === "string") {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "`postedAt` must be ISO timestamp or null." },
          { status: 400 },
        );
      }
      data.postedAt = d;
    }
  }
  if ("error" in body) {
    data.error = typeof body.error === "string" ? body.error : null;
  }

  const existing = await prisma.scheduleEntry.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
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
  const row = await prisma.scheduleEntry.update({ where: { id }, data });
  return NextResponse.json({ data: row });
}
