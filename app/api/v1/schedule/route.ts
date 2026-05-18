import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/**
 * GET /api/v1/schedule — upcoming + recent schedule entries.
 *
 * Replaces the publishing daemon's read from .data/daemon-schedule.json.
 */
export const GET = withUser(async ({ req, user }) => {
  const url = new URL(req.url);
  const onlyUnposted = url.searchParams.get("unposted") === "1";
  const rows = await prisma.scheduleEntry.findMany({
    where: {
      userId: user.id,
      ...(onlyUnposted ? { postedAt: null } : {}),
    },
    orderBy: { publishAt: "asc" },
  });
  return json({ data: rows });
});

/** POST /api/v1/schedule — upsert entry (client-supplied id). */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = requiredStr(body.id, "id");
  const scheduleKind = requiredStr(body.scheduleKind, "scheduleKind");
  if (!["post", "reel", "short"].includes(scheduleKind)) {
    return errors.badRequest(
      "`scheduleKind` must be 'post' | 'reel' | 'short'",
    );
  }
  const publishAtStr = requiredStr(body.publishAt, "publishAt");
  const publishAt = new Date(publishAtStr);
  if (Number.isNaN(publishAt.getTime())) {
    return errors.badRequest("`publishAt` must be a valid ISO timestamp");
  }

  const data = {
    scheduleKind,
    publishAt,
    payload: (body.payload ?? {}) as object,
    reelVideoStored:
      typeof body.reelVideoStored === "boolean" ? body.reelVideoStored : false,
  };

  const entry = await prisma.scheduleEntry.upsert({
    where: { id },
    update: data,
    create: { id, userId: user.id, ...data },
  });
  return json({ data: entry });
});
