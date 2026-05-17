import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Starts Google OAuth (offline access) for YouTube upload scope.
 * Redirect URI must match Google Cloud exactly (see GOOGLE_OAUTH_REDIRECT_URI).
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
    "http://localhost:3002/api/youtube/callback"
  ).trim();

  if (!clientId) {
    return NextResponse.json(
      { error: "Set GOOGLE_CLIENT_ID in .env.local." },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    include_granted_scopes: "true",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
