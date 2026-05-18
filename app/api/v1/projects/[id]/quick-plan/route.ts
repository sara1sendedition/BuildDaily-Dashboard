import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/projects/[id]/quick-plan
 * Mirrors Studio's StorageService.updateQuickPlanSchedule() — narrow update
 * that avoids a full project upsert when only the schedule changes.
 */
export const PATCH = withUser(async ({ req, user, params }) => {
  const existing = await prisma.project.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("Project", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;

  // Prisma JSON columns don't accept JS null directly; use Prisma.DbNull to
  // clear the column when the caller sends null.
  const scheduleValue =
    parsed.data.schedule == null
      ? Prisma.DbNull
      : (parsed.data.schedule as Prisma.InputJsonValue);

  const updated = await prisma.project.update({
    where: { id: params.id },
    data: { quickPlanSchedule: scheduleValue },
    select: { id: true, quickPlanSchedule: true },
  });
  return json({ data: updated });
});
