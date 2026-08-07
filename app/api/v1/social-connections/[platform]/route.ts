import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";
import { socialConnectionPublicSelect } from "@/lib/social-connection-public";

export const runtime = "nodejs";

/** GET /api/v1/social-connections/[platform] — single, no tokens. */
export const GET = withUser(async ({ user, params }) => {
  const row = await prisma.socialConnection.findUnique({
    where: { userId_platform: { userId: user.id, platform: params.platform } },
    select: socialConnectionPublicSelect,
  });
  if (!row) return errors.notFound("SocialConnection", params.platform);
  return json({ data: row });
});

/**
 * PATCH /api/v1/social-connections/[platform] — update public profile fields
 * (username, display name, avatar) without touching tokens.
 */
export const PATCH = withUser(async ({ req, user, params }) => {
  const existing = await prisma.socialConnection.findUnique({
    where: { userId_platform: { userId: user.id, platform: params.platform } },
    select: { id: true },
  });
  if (!existing) return errors.notFound("SocialConnection", params.platform);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: {
    externalUsername?: string | null;
    externalDisplayName?: string | null;
    externalAvatarUrl?: string | null;
    externalUserId?: string | null;
  } = {};
  if ("externalUsername" in body) {
    data.externalUsername = str(body.externalUsername) ?? null;
  }
  if ("externalDisplayName" in body) {
    data.externalDisplayName = str(body.externalDisplayName) ?? null;
  }
  if ("externalAvatarUrl" in body) {
    data.externalAvatarUrl = str(body.externalAvatarUrl) ?? null;
  }
  if ("externalUserId" in body) {
    data.externalUserId = str(body.externalUserId) ?? null;
  }

  if (Object.keys(data).length === 0) {
    return errors.badRequest("No profile fields to update.");
  }

  const row = await prisma.socialConnection.update({
    where: { id: existing.id },
    data,
    select: socialConnectionPublicSelect,
  });
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
