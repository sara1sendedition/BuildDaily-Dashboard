import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import {
  mintStitchUploadJwt,
  STITCH_UPLOAD_JWT_TTL_SECONDS,
} from "@/lib/mint-stitch-upload-jwt";

/**
 * Mint a short-lived HS256 JWT the browser uses to upload directly to the
 * Video to Short backend's /api/stitch-only without going through this
 * Next.js proxy. The backend (FastAPI, app/auth/upload_token.py) verifies
 * the same secret and rejects expired or forged tokens.
 *
 * Why this exists: stitch uploads can be hundreds of MB. The old path was
 * browser -> Next.js proxy -> backend, which means every byte was uploaded
 * twice (browser to Next, then Next to backend). Direct upload eliminates
 * the second leg. Auth has to follow the bytes — Clerk cookies don't
 * cross origins, so we hand the browser a JWT instead.
 *
 * No JOSE/jsonwebtoken dependency on purpose: HS256 is just a base64url
 * header + payload signed with HMAC-SHA256, and Node ships with that.
 * Keeping the dep tree thin matters more here than the ~10 lines of
 * encoding we save by pulling in a library.
 */

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    // Should be unreachable because proxy.ts (Clerk middleware) auth.protect()s
    // everything outside the public matcher. Belt-and-suspenders.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.STITCH_UPLOAD_SECRET;
  const url = process.env.NEXT_PUBLIC_STITCH_UPLOAD_URL;
  if (!secret) {
    return NextResponse.json(
      { error: "STITCH_UPLOAD_SECRET not configured on the server." },
      { status: 503 }
    );
  }
  if (!url) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_STITCH_UPLOAD_URL not configured." },
      { status: 503 }
    );
  }

  const token = mintStitchUploadJwt(secret, userId);

  return NextResponse.json({
    token,
    url,
    exp_seconds: STITCH_UPLOAD_JWT_TTL_SECONDS,
  });
}
