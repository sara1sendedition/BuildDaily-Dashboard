/**
 * Fetch TikTok public profile fields for the authorized user.
 * Uses user.info.basic fields only (open_id, avatar_url, display_name).
 * `username` requires the separate `user.info.username` scope — requesting it
 * without that scope makes the whole user.info call fail, so we omit it here
 * and fill the handle from creator_info elsewhere when available.
 */
export async function fetchTikTokUserProfile(accessToken: string): Promise<{
  openId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}> {
  const fields = ["open_id", "avatar_url", "display_name"].join(",");
  const url = new URL("https://open.tiktokapis.com/v2/user/info/");
  url.searchParams.set("fields", fields);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const j = (await res.json()) as {
    data?: {
      user?: {
        open_id?: string;
        avatar_url?: string;
        display_name?: string;
        username?: string;
      };
    };
    error?: { code?: string; message?: string };
  };
  const errCode = j.error?.code;
  if (!res.ok || (errCode && errCode !== "ok")) {
    throw new Error(
      j.error?.message || `TikTok user.info failed (${res.status}).`,
    );
  }
  const user = j.data?.user;
  return {
    openId: user?.open_id?.trim() || null,
    username: user?.username?.trim() || null,
    displayName: user?.display_name?.trim() || null,
    avatarUrl: user?.avatar_url?.trim() || null,
  };
}

/**
 * TikTok Direct Post creator_info — nickname, username, and avatar in one call.
 * Requires video.publish (or related) scopes already granted for publishing.
 */
export async function fetchTikTokCreatorProfile(accessToken: string): Promise<{
  openId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      cache: "no-store",
    },
  );
  const j = (await res.json()) as {
    data?: {
      creator_nickname?: string;
      creator_username?: string;
      creator_avatar_url?: string;
    };
    error?: { code?: string; message?: string };
  };
  const errCode = j.error?.code;
  if (!res.ok || (errCode && errCode !== "ok")) {
    throw new Error(
      j.error?.message || `TikTok creator_info failed (${res.status}).`,
    );
  }
  const data = j.data ?? {};
  return {
    openId: null,
    username: data.creator_username?.trim() || null,
    displayName: data.creator_nickname?.trim() || null,
    avatarUrl: data.creator_avatar_url?.trim() || null,
  };
}

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/**
 * Exchange a TikTok refresh token for a short-lived access token.
 * Returns the new access token and the rotated refresh token when present.
 */
export async function refreshTikTokAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
  openId: string | null;
}> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) {
    throw new Error(
      "TikTok client credentials are not configured on the Hub (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET).",
    );
  }

  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    open_id?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        `TikTok token refresh failed (${res.status}).`,
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
    scopes: data.scope
      ? data.scope.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    openId: data.open_id ?? null,
  };
}
