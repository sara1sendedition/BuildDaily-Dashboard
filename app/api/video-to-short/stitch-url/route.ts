import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { mintStitchUploadJwt } from "@/lib/mint-stitch-upload-jwt";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

/**
 * Stitch via pre-uploaded Bunny URLs.
 *
 * The browser uploads each source clip straight to Bunny's edge first, then
 * POSTs the resulting URLs here (a tiny JSON body). We mint the short-lived
 * stitch JWT and forward to the backend `/api/stitch-only-url`. Because this
 * request is small and fast, a backgrounded tab / network blip can no longer
 * orphan the job the way the old multi-minute multipart upload did.
 */
export async function POST(req: NextRequest) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.STITCH_UPLOAD_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STITCH_UPLOAD_SECRET not configured on the server." },
      { status: 503 },
    );
  }

  let body: { file_urls?: unknown; client_correlation_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const fileUrls = Array.isArray(body.file_urls)
    ? body.file_urls.filter(
        (u): u is string => typeof u === "string" && u.trim().length > 0,
      )
    : [];
  if (fileUrls.length === 0) {
    return NextResponse.json(
      { error: "file_urls is required." },
      { status: 400 },
    );
  }
  const correlationId =
    typeof body.client_correlation_id === "string"
      ? body.client_correlation_id
      : "";

  const token = mintStitchUploadJwt(secret, userId);
  const base = getVideoToShortApiBaseUrl();

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/stitch-only-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        file_urls: fileUrls,
        client_correlation_id: correlationId,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Cannot reach Video to Short API at ${base}. ${msg}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json",
    },
  });
}
