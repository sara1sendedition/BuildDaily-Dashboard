import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/challenges/enrollments */
export const GET = withUser(async ({ user }) => {
  const rows = await prisma.challengeEnrollment.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: rows });
});

/** POST /api/v1/challenges/enrollments — upsert (client-supplied id). */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = requiredStr(body.id, "id");
  const challengeId = requiredStr(body.challengeId, "challengeId");
  const projectId = requiredStr(body.projectId, "projectId");

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) return errors.notFound("Project", projectId);

  const enrollment = await prisma.challengeEnrollment.upsert({
    where: { id },
    update: { challengeId, projectId },
    create: { id, userId: user.id, challengeId, projectId },
  });
  return json({ data: enrollment });
});
