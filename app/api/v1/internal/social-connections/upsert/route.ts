import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";
import {
  encryptToken,
  isConnectionCryptoConfigured,
} from "@/lib/crypto/connection-tokens";

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
 * POST /api/v1/internal/social-connections/upsert
 *
 * Server-to-server (shared-secret) endpoint that lets another app — e.g. the
 * Multiplier's TikTok OAuth callback — persist a user's connection tokens on
 * the Hub. The caller sends PLAINTEXT tokens; this endpoint encrypts them with
 * CONNECTION_TOKEN_KEY before writing, so the crypto key never leaves the Hub.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 *
 * Body:
 *   {
 *     userId: string,            // Clerk user id (user_xxx)
 *     email: string,             // Clerk primary email (to upsert the users row)
 *     platform: string,          // one of PLATFORMS
 *     refreshToken?: string,     // plaintext; encrypted here
 *     accessToken?: string,      // plaintext; encrypted here
 *     tokenExpiresAt?: string,   // ISO datetime
 *     scopes?: string[],
 *     externalUserId?: string,   // e.g. TikTok open_id
 *     externalUsername?: string
 *   }
 */
export async function POST(request: Request) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  if (!isConnectionCryptoConfigured()) {
    return NextResponse.json(
      {
        type: "/errors/internal-misconfigured",
        title: "Connection crypto not configured",
        status: 503,
        detail:
          "CONNECTION_TOKEN_KEY is not set on the Hub. Add it in Coolify env.",
      },
      { status: 503, headers: { "Content-Type": "application/problem+json" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const platform =
    typeof body.platform === "string" ? body.platform.trim() : "";
  const refreshToken =
    typeof body.refreshToken === "string" ? body.refreshToken : undefined;
  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken : undefined;

  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json(
      { error: `platform must be one of: ${PLATFORMS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!accessToken && !refreshToken) {
    return NextResponse.json(
      { error: "At least one of accessToken or refreshToken is required." },
      { status: 400 },
    );
  }

  const tokenExpiresAt =
    typeof body.tokenExpiresAt === "string"
      ? new Date(body.tokenExpiresAt)
      : null;
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === "string")
    : [];
  const externalUserId =
    typeof body.externalUserId === "string" ? body.externalUserId : null;
  const externalUsername =
    typeof body.externalUsername === "string" ? body.externalUsername : null;

  // Ensure the user row exists (SocialConnection FK -> users). Email is only
  // needed to CREATE a new user row (it's required + unique in the schema);
  // token-rotation calls that happen after the initial connect won't send it,
  // and that's fine because the row already exists.
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existingUser) {
    if (!email) {
      return NextResponse.json(
        { error: "email is required to create a new user." },
        { status: 400 },
      );
    }
    await prisma.user.create({
      data: { id: userId, email, membershipType: "free" },
    });
  }

  const data = {
    platform,
    accessTokenEnc: accessToken
      ? encryptToken(accessToken)
      : // access token is optional; store a marker-free empty-safe value only
        // when present. The column is non-null, so when only a refresh token is
        // supplied we encrypt an empty string as a placeholder.
        encryptToken(""),
    refreshTokenEnc: refreshToken ? encryptToken(refreshToken) : null,
    tokenExpiresAt,
    scopes,
    externalUserId,
    externalUsername,
  };

  const row = await prisma.socialConnection.upsert({
    where: { userId_platform: { userId, platform } },
    update: data,
    create: { userId, ...data },
    select: {
      id: true,
      platform: true,
      externalUserId: true,
      externalUsername: true,
      tokenExpiresAt: true,
      scopes: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: row });
}
