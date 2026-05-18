import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/social-connections/[platform] — single, no tokens. */
export const GET = withUser(async ({ user, params }) => {
  const row = await prisma.socialConnection.findUnique({
    where: { userId_platform: { userId: user.id, platform: params.platform } },
    select: {
      id: true,
      platform: true,
      externalUserId: true,
      externalUsername: true,
      tokenExpiresAt: true,
      scopes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return errors.notFound("SocialConnection", params.platform);
  return json({ data: row });
});

/** DELETE /api/v1/social-connections/[platform] — revoke the user's link. */
export const DELETE = withUser(async ({ user, params }) => {
  const row = await prisma.socialConnection.findUnique({
    where: { userId_platform: { userId: user.id, platform: params.platform } },
    select: { id: true },
  });
  if (!row) return errors.notFound("SocialConnection", params.platform);
  await prisma.socialConnection.delete({ where: { id: row.id } });
  return new Response(null, { status: 204 });
});
