import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * OAuth redirect: exchanges `code` for tokens and shows refresh_token once
 * (add to .env.local as GOOGLE_YOUTUBE_REFRESH_TOKEN).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  if (err) {
    const body = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>YouTube OAuth</title></head><body><p>Access denied: ${escapeHtml(err)} ${escapeHtml(errDesc ?? "")}</p></body></html>`;
    return new NextResponse(body, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return new NextResponse(
      "<!DOCTYPE html><html><body><p>Missing <code>code</code> query parameter.</p></body></html>",
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
    "http://localhost:3002/api/youtube/callback"
  ).trim();

  if (!clientId || !clientSecret) {
    return new NextResponse(
      "<!DOCTYPE html><html><body><p>Server missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.</p></body></html>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = (await tokenRes.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || data.error) {
    const msg = data.error_description || data.error || tokenRes.statusText;
    const body = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><p>Token exchange failed.</p><pre>${escapeHtml(msg)}</pre></body></html>`;
    return new NextResponse(body, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const refresh = data.refresh_token;
  if (!refresh) {
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
        <p>No <code>refresh_token</code> returned. Revoke app access in your Google account and try again with <code>prompt=consent</code> (this flow already requests it).</p>
        <p>If you already authorized, remove the app from <a href="https://myaccount.google.com/permissions">Google Account permissions</a> and open the auth link again.</p>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>YouTube connected</title>
    <style>body{font-family:system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;}pre{white-space:pre-wrap;word-break:break-all;background:#f5f5f4;padding:1rem;border-radius:8px}</style>
    </head><body>
    <h1>Copy refresh token to <code>.env.local</code></h1>
    <p>Add or update:</p>
    <pre>GOOGLE_YOUTUBE_REFRESH_TOKEN=${escapeHtml(refresh)}</pre>
    <p>Restart the dev server, then use <strong>Publish now…</strong> with <strong>YouTube</strong> checked (Short only).</p>
    </body></html>`;

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
