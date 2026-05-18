import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/broll/[id] */
export const GET = withUser(async ({ user, params }) => {
  const clip = await prisma.brollClip.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!clip) return errors.notFound("BrollClip", params.id);
  return json({ data: clip });
});

/** DELETE /api/v1/broll/[id] — DB row only; storage cleanup is separate. */
export const DELETE = withUser(async ({ user, params }) => {
  const existing = await prisma.brollClip.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("BrollClip", params.id);
  await prisma.brollClip.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
