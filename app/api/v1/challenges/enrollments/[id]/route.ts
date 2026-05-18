import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/challenges/enrollments/[id] */
export const GET = withUser(async ({ user, params }) => {
  const row = await prisma.challengeEnrollment.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!row) return errors.notFound("ChallengeEnrollment", params.id);
  return json({ data: row });
});

/** DELETE /api/v1/challenges/enrollments/[id] */
export const DELETE = withUser(async ({ user, params }) => {
  const row = await prisma.challengeEnrollment.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!row) return errors.notFound("ChallengeEnrollment", params.id);
  await prisma.challengeEnrollment.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
