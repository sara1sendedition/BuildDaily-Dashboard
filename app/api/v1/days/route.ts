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
 * GET /api/v1/days
 *
 * Query params (mutually exclusive shapes):
 *   - ?projectId=X                 → all days for project (Studio's getDaysForProject)
 *   - ?projectId=X&date=YYYY-MM-DD → all videos for that day (getVideosForDay)
 *   - ?projectId=X&date=YYYY-MM-DD&latest=1 → most recent for that day (getDay)
 */
export const GET = withUser(async ({ req, user }) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return errors.badRequest("`projectId` query param is required");
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) return errors.notFound("Project", projectId);

  const dateStr = url.searchParams.get("date");
  const latest =
    url.searchParams.get("latest") === "1" ||
    url.searchParams.get("latest") === "true";

  if (dateStr) {
    // YYYY-MM-DD → Prisma expects DateTime for @db.Date
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return errors.badRequest("`date` must be YYYY-MM-DD");
    }
    const days = await prisma.dayRecord.findMany({
      where: { projectId, date },
      orderBy: { createdAt: "desc" },
      take: latest ? 1 : undefined,
    });
    return json({ data: latest ? (days[0] ?? null) : days });
  }

  const days = await prisma.dayRecord.findMany({
    where: { projectId },
    orderBy: { date: "desc" },
  });
  return json({ data: days });
});

/** POST /api/v1/days — upsert a day record (Studio supplies client id). */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = requiredStr(body.id, "id");
  const projectId = requiredStr(body.projectId, "projectId");
  const dateStr = requiredStr(body.date, "date");
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return errors.badRequest("`date` must be YYYY-MM-DD");
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) return errors.notFound("Project", projectId);

  const payload = (body.payload ?? {}) as object;

  const day = await prisma.dayRecord.upsert({
    where: { id },
    update: { date, payload },
    create: { id, userId: user.id, projectId, date, payload },
  });
  return json({ data: day });
});
