import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";
import {
  decryptToken,
  encryptToken,
  isConnectionCryptoConfigured,
} from "@/lib/crypto/connection-tokens";
import { socialConnectionPublicSelect } from "@/lib/social-connection-public";
import {
  fetchTikTokCreatorProfile,
  fetchTikTokUserProfile,
  refreshTikTokAccessToken,
} from "@/lib/tiktok/user-profile";

export const runtime = "nodejs";
export const maxDuration = 30;

type TikTokProfile = {
  openId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

function looksLikeAccessTokenAuthError(message: string): boolean {
  return /access.?token|unauthorized|invalid.?grant|expired|401|scope/i.test(
    message,
  );
}

async function loadTikTokProfile(accessToken: string): Promise<TikTokProfile> {
  // Merge creator_info (username + nickname + avatar) with user.info.basic
  // (open_id + display_name + avatar) so a partial creator_info response does
  // not block filling missing fields from user.info.
  let creator: TikTokProfile | null = null;
  let basic: TikTokProfile | null = null;
  const errorsFound: string[] = [];
  try {
    creator = await fetchTikTokCreatorProfile(accessToken);
  } catch (e) {
    errorsFound.push(e instanceof Error ? e.message : "creator_info failed");
  }
  try {
    basic = await fetchTikTokUserProfile(accessToken);
  } catch (e) {
    errorsFound.push(e instanceof Error ? e.message : "user.info failed");
  }
  if (!creator && !basic) {
    const authMsg = errorsFound.find((m) => looksLikeAccessTokenAuthError(m));
    throw new Error(
      authMsg || errorsFound[0] || "TikTok profile fetch failed.",
    );
  }
  return {
    openId: basic?.openId || creator?.openId || null,
    username: creator?.username || basic?.username || null,
    displayName: creator?.displayName || basic?.displayName || null,
    avatarUrl: creator?.avatarUrl || basic?.avatarUrl || null,
  };
}

/**
 * POST /api/v1/social-connections/[platform]/refresh-profile
 *
 * Same-origin: loads the user's stored tokens, fetches the live platform
 * profile (avatar + nickname), and caches it on the connection row.
 * Currently implemented for TikTok.
 *
 * Important: TikTok refresh tokens rotate on every use. We only refresh when
 * the access token is missing/expired or the profile call looks like an auth
 * failure — never on rate limits or transient API errors.
 */
export const POST = withUser(async ({ user, params }) => {
  const platform = params.platform;
  if (platform !== "tiktok") {
    return errors.badRequest(
      `Profile refresh is not supported for platform \`${platform}\`.`,
    );
  }

  if (!isConnectionCryptoConfigured()) {
    return errors.internal("CONNECTION_TOKEN_KEY is not configured.");
  }

  const row = await prisma.socialConnection.findUnique({
    where: { userId_platform: { userId: user.id, platform } },
    select: {
      id: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
      externalUsername: true,
      externalDisplayName: true,
      externalAvatarUrl: true,
      externalUserId: true,
    },
  });
  if (!row) return errors.notFound("SocialConnection", platform);

  // Already have the fields Settings needs — avoid live TikTok / token rotation.
  if (row.externalAvatarUrl && row.externalDisplayName) {
    const existing = await prisma.socialConnection.findUnique({
      where: { id: row.id },
      select: socialConnectionPublicSelect,
    });
    return json({ data: existing });
  }

  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  try {
    const decAccess = row.accessTokenEnc ? decryptToken(row.accessTokenEnc) : "";
    accessToken = decAccess.length > 0 ? decAccess : null;
    refreshToken = row.refreshTokenEnc
      ? decryptToken(row.refreshTokenEnc)
      : null;
  } catch {
    return errors.internal("Stored token could not be decrypted (key mismatch?).");
  }

  const accessLooksFresh =
    Boolean(accessToken) &&
    row.tokenExpiresAt != null &&
    row.tokenExpiresAt.getTime() > Date.now() + 60_000;

  let profile: TikTokProfile | null = null;
  let lastError: string | null = null;
  let accessAuthFailed = false;

  if (accessLooksFresh && accessToken) {
    try {
      profile = await loadTikTokProfile(accessToken);
    } catch (e) {
      lastError =
        e instanceof Error ? e.message : "access token profile fetch failed";
      accessAuthFailed = looksLikeAccessTokenAuthError(lastError);
      profile = null;
    }
  }

  const shouldRefresh =
    !profile &&
    Boolean(refreshToken) &&
    (!accessToken || !accessLooksFresh || accessAuthFailed);

  if (shouldRefresh && refreshToken) {
    try {
      const refreshed = await refreshTikTokAccessToken(refreshToken);
      accessToken = refreshed.accessToken;

      const tokenUpdate: {
        accessTokenEnc: string;
        refreshTokenEnc?: string;
        tokenExpiresAt?: Date | null;
        scopes?: string[];
        externalUserId?: string;
      } = {
        accessTokenEnc: encryptToken(refreshed.accessToken),
      };
      if (refreshed.refreshToken) {
        tokenUpdate.refreshTokenEnc = encryptToken(refreshed.refreshToken);
      }
      if (refreshed.expiresIn != null) {
        tokenUpdate.tokenExpiresAt = new Date(
          Date.now() + refreshed.expiresIn * 1000,
        );
      }
      if (refreshed.scopes.length > 0) {
        tokenUpdate.scopes = refreshed.scopes;
      }
      if (refreshed.openId) {
        tokenUpdate.externalUserId = refreshed.openId;
      }
      await prisma.socialConnection.update({
        where: { id: row.id },
        data: tokenUpdate,
      });

      profile = await loadTikTokProfile(refreshed.accessToken);
    } catch (e) {
      lastError =
        e instanceof Error ? e.message : "refresh + profile fetch failed";
    }
  }

  if (!profile) {
    return errors.badRequest(
      lastError ||
        "Could not load TikTok profile. Reconnect TikTok or ensure TIKTOK_CLIENT_KEY/SECRET are set on the Hub.",
    );
  }

  const profileData: {
    externalUserId?: string;
    externalUsername?: string;
    externalDisplayName?: string;
    externalAvatarUrl?: string;
  } = {};
  if (profile.openId) profileData.externalUserId = profile.openId;
  if (profile.username) profileData.externalUsername = profile.username;
  if (profile.displayName) profileData.externalDisplayName = profile.displayName;
  if (profile.avatarUrl) profileData.externalAvatarUrl = profile.avatarUrl;

  if (Object.keys(profileData).length === 0) {
    const existing = await prisma.socialConnection.findUnique({
      where: { id: row.id },
      select: socialConnectionPublicSelect,
    });
    return json({ data: existing });
  }

  const updated = await prisma.socialConnection.update({
    where: { id: row.id },
    data: profileData,
    select: socialConnectionPublicSelect,
  });

  return json({ data: updated });
});
