import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/social-connections/pull-credentials
 *
 * Server-to-server endpoint. Returns the Hub's own env-held platform pull
 * credentials so associated tools (e.g. Comment Convert / comment-inbox) can
 * read comments without keeping their own copies. The Hub is the single source
 * of truth for these tokens.
 *
 * Auth: `Authorization: Bearer <HUB_CREDENTIALS_SECRET>` — a dedicated shared
 * secret for the tool<->hub credential link (separate from SCHEDULE_DAEMON_SECRET).
 * NEVER expose to the browser — returns plaintext secrets.
 */
export async function POST(request: Request) {
  const secret = process.env.HUB_CREDENTIALS_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "HUB_CREDENTIALS_SECRET is not set on the Hub." },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match ? match[1]!.trim() : "";
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const metaAccessToken = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  const metaPageId = process.env.META_PAGE_ID?.trim();
  const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim();
  const youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID?.trim();

  return NextResponse.json({
    data: {
      meta:
        metaAccessToken && metaPageId
          ? { pageId: metaPageId, accessToken: metaAccessToken }
          : null,
      youtube:
        youtubeApiKey && youtubeChannelId
          ? { apiKey: youtubeApiKey, channelId: youtubeChannelId }
          : null,
    },
  });
}
