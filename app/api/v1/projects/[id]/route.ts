import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/projects/[id] */
export const GET = withUser(async ({ user, params }) => {
  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!project) return errors.notFound("Project", params.id);
  return json({ data: project });
});

/** DELETE /api/v1/projects/[id] — cascades to day_records + challenge_enrollments. */
export const DELETE = withUser(async ({ user, params }) => {
  const existing = await prisma.project.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("Project", params.id);
  await prisma.project.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
