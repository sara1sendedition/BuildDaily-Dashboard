import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/days/[id] — Studio's getDayById. */
export const GET = withUser(async ({ user, params }) => {
  const day = await prisma.dayRecord.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!day) return errors.notFound("DayRecord", params.id);
  return json({ data: day });
});

/** DELETE /api/v1/days/[id] */
export const DELETE = withUser(async ({ user, params }) => {
  const existing = await prisma.dayRecord.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("DayRecord", params.id);
  await prisma.dayRecord.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
