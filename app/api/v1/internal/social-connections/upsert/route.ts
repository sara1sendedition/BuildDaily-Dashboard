import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";
import {
  encryptToken,
  isConnectionCryptoConfigured,
} from "@/lib/crypto/connection-tokens";
import { socialConnectionPublicSelect } from "@/lib/social-connection-public";
import { errors } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

function persistFailureMessage(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const target = Array.isArray(e.meta?.target)
        ? (e.meta.target as string[]).join(", ")
        : "unique field";
      return `Already exists (${target}).`;
    }
    if (e.code === "P2003") {
      return "Hub user row is missing. Open Calendar once while signed in, then connect TikTok again.";
    }
    if (e.code === "P2022") {
      return `Hub database is missing a column (${String(e.meta?.column ?? "unknown")}). Run prisma migrate deploy on the Hub.`;
    }
    return `${e.code}: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Unknown error";
}

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
 * Profile fields (external*) and token fields are only written when the caller
 * includes them, so token-rotation / profile-only calls do not wipe the other.
 */
export async function POST(request: Request) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

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

  const profilePatch: {
    externalUserId?: string | null;
    externalUsername?: string | null;
    externalDisplayName?: string | null;
    externalAvatarUrl?: string | null;
  } = {};
  if (typeof body.externalUserId === "string") {
    profilePatch.externalUserId = body.externalUserId;
  }
  if (typeof body.externalUsername === "string") {
    profilePatch.externalUsername = body.externalUsername;
  }
  if (typeof body.externalDisplayName === "string") {
    profilePatch.externalDisplayName = body.externalDisplayName;
  }
  if (typeof body.externalAvatarUrl === "string") {
    profilePatch.externalAvatarUrl = body.externalAvatarUrl;
  }

  const hasToken = Boolean(accessToken || refreshToken);
  const hasProfile = Object.keys(profilePatch).length > 0;

  if (!hasToken && !hasProfile) {
    return NextResponse.json(
      {
        error:
          "At least one of accessToken, refreshToken, or a profile field is required.",
      },
      { status: 400 },
    );
  }

  // Profile-only updates do not need the crypto key.
  if (!hasToken) {
    const existing = await prisma.socialConnection.findUnique({
      where: { userId_platform: { userId, platform } },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "No existing connection to update profile for." },
        { status: 404 },
      );
    }
    const row = await prisma.socialConnection.update({
      where: { id: existing.id },
      data: profilePatch,
      select: socialConnectionPublicSelect,
    });
    return NextResponse.json({ data: row });
  }

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

  const tokenExpiresAtProvided = typeof body.tokenExpiresAt === "string";
  const tokenExpiresAt = tokenExpiresAtProvided
    ? new Date(body.tokenExpiresAt as string)
    : undefined;
  if (tokenExpiresAtProvided && tokenExpiresAt && Number.isNaN(tokenExpiresAt.getTime())) {
    return NextResponse.json(
      { error: "tokenExpiresAt must be a valid ISO timestamp." },
      { status: 400 },
    );
  }
  const scopesProvided = Array.isArray(body.scopes);
  const scopes = scopesProvided
    ? (body.scopes as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : undefined;

  try {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: email || `${userId}@users.noreply.builddaily.app`,
        membershipType: "free",
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      email
    ) {
      return errors.conflict(
        "This email is already on the Hub under a different user id. Open Calendar while signed in, then retry TikTok.",
      );
    }
    console.error("[social-connections/upsert] user persist failed:", e);
    return errors.internal(persistFailureMessage(e));
  }

  try {
    const existingConn = await prisma.socialConnection.findUnique({
      where: { userId_platform: { userId, platform } },
      select: { id: true },
    });

    if (existingConn) {
      const updateData: {
        accessTokenEnc?: string;
        refreshTokenEnc?: string | null;
        tokenExpiresAt?: Date | null;
        scopes?: string[];
        externalUserId?: string | null;
        externalUsername?: string | null;
        externalDisplayName?: string | null;
        externalAvatarUrl?: string | null;
      } = { ...profilePatch };
      if (accessToken) {
        updateData.accessTokenEnc = encryptToken(accessToken);
      }
      if (refreshToken) {
        updateData.refreshTokenEnc = encryptToken(refreshToken);
      }
      if (tokenExpiresAtProvided) {
        updateData.tokenExpiresAt = tokenExpiresAt ?? null;
      }
      if (scopesProvided && scopes) {
        updateData.scopes = scopes;
      }

      const row = await prisma.socialConnection.update({
        where: { id: existingConn.id },
        data: updateData,
        select: socialConnectionPublicSelect,
      });
      return NextResponse.json({ data: row });
    }

    const row = await prisma.socialConnection.create({
      data: {
        userId,
        platform,
        accessTokenEnc: accessToken
          ? encryptToken(accessToken)
          : encryptToken(""),
        refreshTokenEnc: refreshToken ? encryptToken(refreshToken) : null,
        tokenExpiresAt: tokenExpiresAt ?? null,
        scopes: scopes ?? [],
        externalUserId: profilePatch.externalUserId ?? null,
        externalUsername: profilePatch.externalUsername ?? null,
        externalDisplayName: profilePatch.externalDisplayName ?? null,
        externalAvatarUrl: profilePatch.externalAvatarUrl ?? null,
      },
      select: socialConnectionPublicSelect,
    });

    return NextResponse.json({ data: row });
  } catch (e) {
    console.error("[social-connections/upsert] connection persist failed:", e);
    return errors.internal(persistFailureMessage(e));
  }
}
