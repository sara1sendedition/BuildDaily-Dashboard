import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
  str,
  optStrArr,
} from "@/app/api/v1/_lib/responses";
import { socialConnectionPublicSelect } from "@/lib/social-connection-public";

export const runtime = "nodejs";

const PLATFORMS = [
  "linkedin",
  "x",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "facebook",
  "medium",
  "substack",
] as const;

/**
 * GET /api/v1/social-connections — list (token fields excluded).
 *
 * Tools call this to see WHICH platforms the user has connected, without
 * receiving the actual tokens. To get an actual access token for a server-
 * to-server call, use POST /api/v1/social-connections/[platform]/token-mint
 * (service-token-only; not exposed here).
 */
export const GET = withUser(async ({ user }) => {
  const rows = await prisma.socialConnection.findMany({
    where: { userId: user.id },
    orderBy: { platform: "asc" },
    select: socialConnectionPublicSelect,
  });
  return json({ data: rows });
});

/**
 * POST /api/v1/social-connections — upsert a connection's encrypted tokens.
 *
 * Used by the hub's existing OAuth callbacks (e.g. /api/youtube/callback)
 * during the post-Phase-2 era. Tokens MUST already be encrypted by the
 * caller with the hub's CONNECTION_TOKEN_KEY before being POSTed here —
 * this endpoint does not re-encrypt.
 */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const platform = requiredStr(body.platform, "platform");
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    return errors.badRequest(`\`platform\` must be one of: ${PLATFORMS.join(", ")}`);
  }
  const accessTokenEnc = requiredStr(body.accessTokenEnc, "accessTokenEnc");

  const tokenExpiresAt =
    typeof body.tokenExpiresAt === "string"
      ? new Date(body.tokenExpiresAt)
      : null;

  const profilePatch: {
    externalUserId?: string | null;
    externalUsername?: string | null;
    externalDisplayName?: string | null;
    externalAvatarUrl?: string | null;
  } = {};
  if ("externalUserId" in body) {
    profilePatch.externalUserId = str(body.externalUserId) ?? null;
  }
  if ("externalUsername" in body) {
    profilePatch.externalUsername = str(body.externalUsername) ?? null;
  }
  if ("externalDisplayName" in body) {
    profilePatch.externalDisplayName = str(body.externalDisplayName) ?? null;
  }
  if ("externalAvatarUrl" in body) {
    profilePatch.externalAvatarUrl = str(body.externalAvatarUrl) ?? null;
  }

  const data = {
    platform,
    accessTokenEnc,
    refreshTokenEnc: str(body.refreshTokenEnc) ?? null,
    tokenExpiresAt,
    scopes: optStrArr(body.scopes) ?? [],
    webhookSecret: str(body.webhookSecret) ?? null,
    ...profilePatch,
  };

  const row = await prisma.socialConnection.upsert({
    where: { userId_platform: { userId: user.id, platform } },
    update: data,
    create: {
      userId: user.id,
      ...data,
      externalUserId: profilePatch.externalUserId ?? null,
      externalUsername: profilePatch.externalUsername ?? null,
      externalDisplayName: profilePatch.externalDisplayName ?? null,
      externalAvatarUrl: profilePatch.externalAvatarUrl ?? null,
    },
    select: socialConnectionPublicSelect,
  });
  return json({ data: row });
});
