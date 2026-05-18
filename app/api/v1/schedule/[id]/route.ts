import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/schedule/[id] */
export const GET = withUser(async ({ user, params }) => {
  const row = await prisma.scheduleEntry.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!row) return errors.notFound("ScheduleEntry", params.id);
  return json({ data: row });
});

/**
 * PATCH /api/v1/schedule/[id] — used to mark posted / error.
 *
 * Body shape (any subset):
 *   { postedAt?: ISO string | null, error?: string | null }
 */
export const PATCH = withUser(async ({ req, user, params }) => {
  const existing = await prisma.scheduleEntry.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("ScheduleEntry", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if ("postedAt" in body) {
    const v = body.postedAt;
    if (v === null) data.postedAt = null;
    else if (typeof v === "string") {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        return errors.badRequest("`postedAt` must be ISO timestamp or null");
      }
      data.postedAt = d;
    }
  }
  if ("error" in body) {
    data.error = typeof body.error === "string" ? body.error : null;
  }

  const row = await prisma.scheduleEntry.update({
    where: { id: params.id },
    data,
  });
  return json({ data: row });
});

/** DELETE /api/v1/schedule/[id] */
export const DELETE = withUser(async ({ user, params }) => {
  const existing = await prisma.scheduleEntry.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("ScheduleEntry", params.id);
  await prisma.scheduleEntry.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
