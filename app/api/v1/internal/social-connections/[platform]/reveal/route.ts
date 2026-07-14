import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";
import {
  decryptToken,
  isConnectionCryptoConfigured,
} from "@/lib/crypto/connection-tokens";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/social-connections/[platform]/reveal
 *
 * Server-to-server (shared-secret) endpoint. Given a userId, returns the
 * DECRYPTED refresh/access token for that user's connection on `[platform]`.
 * The caller (e.g. the Multiplier's TikTok publish path) uses the refresh
 * token to mint a short-lived access token, then — because TikTok rotates the
 * refresh token on use — writes the new one back via
 * `/api/v1/internal/social-connections/upsert`.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 * Body: { userId: string }
 *
 * NEVER expose this route to the browser — it returns plaintext secrets.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ platform: string }> } | { params: { platform: string } },
) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  if (!isConnectionCryptoConfigured()) {
    return NextResponse.json(
      { error: "CONNECTION_TOKEN_KEY is not set on the Hub." },
      { status: 503 },
    );
  }

  const rawParams = (ctx as { params: unknown }).params;
  const params =
    typeof (rawParams as Promise<unknown>)?.then === "function"
      ? await (rawParams as Promise<{ platform: string }>)
      : (rawParams as { platform: string });
  const platform = params.platform;

  let body: { userId?: string };
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const row = await prisma.socialConnection.findUnique({
    where: { userId_platform: { userId, platform } },
    select: {
      refreshTokenEnc: true,
      accessTokenEnc: true,
      tokenExpiresAt: true,
      scopes: true,
      externalUserId: true,
      externalUsername: true,
    },
  });
  if (!row) {
    return NextResponse.json(
      { error: `No ${platform} connection for this user.` },
      { status: 404 },
    );
  }

  let refreshToken: string | null = null;
  let accessToken: string | null = null;
  try {
    refreshToken = row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null;
    const dec = row.accessTokenEnc ? decryptToken(row.accessTokenEnc) : "";
    accessToken = dec.length > 0 ? dec : null;
  } catch {
    return NextResponse.json(
      { error: "Stored token could not be decrypted (key mismatch?)." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      refreshToken,
      accessToken,
      tokenExpiresAt: row.tokenExpiresAt,
      scopes: row.scopes,
      externalUserId: row.externalUserId,
      externalUsername: row.externalUsername,
    },
  });
}
