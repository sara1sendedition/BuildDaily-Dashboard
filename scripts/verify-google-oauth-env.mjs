/**
 * Verifies GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET against Google's token endpoint.
 * Run: node --env-file=.env scripts/verify-google-oauth-env.mjs
 *
 * Optional: GOOGLE_OAUTH_REDIRECT_URI (must match Google Cloud "Authorized redirect URIs").
 */

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirectUri =
  process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
  "http://localhost:3002/api/youtube/callback";

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in the environment.");
  process.exit(1);
}

const body = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  code: "intentionally-invalid-code",
  grant_type: "authorization_code",
  redirect_uri: redirectUri,
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});

const data = await res.json();

if (data.error === "invalid_grant") {
  console.log(
    "OK: Google accepted this OAuth client (invalid_grant = bad code, as expected)."
  );
  console.log(`     redirect_uri used: ${redirectUri}`);
  process.exit(0);
}

if (data.error === "invalid_client") {
  console.error(
    "FAIL: invalid_client — check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and that the OAuth client is enabled."
  );
  if (data.error_description) console.error(`     ${data.error_description}`);
  process.exit(1);
}

if (data.error === "redirect_uri_mismatch") {
  console.error(
    "FAIL: redirect_uri_mismatch — set GOOGLE_OAUTH_REDIRECT_URI to a URI listed in Google Cloud (exact match)."
  );
  console.error(`     tried: ${redirectUri}`);
  process.exit(1);
}

console.error("Unexpected response:", data.error ?? res.status, data.error_description ?? "");
process.exit(1);
