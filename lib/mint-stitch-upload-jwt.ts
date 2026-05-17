import { createHmac, randomUUID } from "node:crypto";

/**
 * Token lifetime for direct stitch uploads. Was 300 (5 min) initially, but
 * a 2-clip stitch on a slow uplink can have the bytes still in flight at
 * the 5-min mark — the backend then rejects with "Token expired" once the
 * body finishes arriving and the dependency resolves. 1800 (30 min) is
 * generous enough for a multi-hundred-MB batch on a poor connection while
 * still being a real authn boundary if a token leaks.
 */
export const STITCH_UPLOAD_JWT_TTL_SECONDS = 1800;

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signHs256(secret: string, headerB64: string, payloadB64: string): string {
  const sig = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  return b64url(sig);
}

/**
 * HS256 JWT for Video to Short `/api/stitch-only` (same secret as FastAPI).
 */
export function mintStitchUploadJwt(
  secret: string,
  sub: string,
  ttlSeconds = STITCH_UPLOAD_JWT_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64url(
    JSON.stringify({
      sub,
      iat: now,
      exp: now + ttlSeconds,
      jti: randomUUID(),
    })
  );
  const sig = signHs256(secret, headerB64, payloadB64);
  return `${headerB64}.${payloadB64}.${sig}`;
}
