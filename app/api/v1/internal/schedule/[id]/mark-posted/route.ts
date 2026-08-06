import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/schedule/[id]/mark-posted
 *
 * Records publish results. Always clears `publishClaimedAt` so the soft claim
 * from claim-publish does not stick after success or failure.
 *
 * Body (any subset):
 *   { postedAt?: ISO timestamp | null, error?: string | null,
 *     publishResults?: { instagramMediaId?, facebookPostId?, youtubeVideoId?, tiktokPublishId? } }
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 */
type ParamsCtx = { params: Promise<{ id: string }> };

type PublishResults = {
  instagramMediaId?: string;
  facebookPostId?: string;
  youtubeVideoId?: string;
  tiktokPublishId?: string;
};

export async function POST(request: Request, ctx: ParamsCtx) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  const { id } = await ctx.params;

  let body: {
    postedAt?: string | null;
    error?: string | null;
    publishResults?: PublishResults;
  };
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {
    // Always release the soft claim after a publish attempt settles.
    publishClaimedAt: null,
  };
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
    select: { id: true, payload: true },
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

  const results = body.publishResults;
  if (results && typeof results === "object") {
    const prev =
      existing.payload && typeof existing.payload === "object"
        ? ({ ...(existing.payload as Record<string, unknown>) } as Record<
            string,
            unknown
          >)
        : {};
    const prevResults =
      prev.publishResults && typeof prev.publishResults === "object"
        ? ({ ...(prev.publishResults as Record<string, unknown>) } as Record<
            string,
            unknown
          >)
        : {};
    const nextResults = { ...prevResults };
    for (const key of [
      "instagramMediaId",
      "facebookPostId",
      "youtubeVideoId",
      "tiktokPublishId",
    ] as const) {
      const v = results[key];
      if (typeof v === "string" && v.trim()) nextResults[key] = v.trim();
    }
    data.payload = {
      ...prev,
      publishResults: nextResults,
    } as Prisma.InputJsonValue;
  }

  const row = await prisma.scheduleEntry.update({ where: { id }, data });
  return NextResponse.json({ data: row });
}
