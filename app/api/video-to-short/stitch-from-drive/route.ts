import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { mintStitchUploadJwt } from "@/lib/mint-stitch-upload-jwt";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Stitch-only from Google Drive inbox file ids (server-side download + concat).
 */
export async function POST(req: NextRequest) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 }
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
      { status: 503 }
    );
  }

  let body: { file_ids?: unknown; client_correlation_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const fileIds = Array.isArray(body.file_ids)
    ? body.file_ids.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    : [];
  if (fileIds.length < 2) {
    return NextResponse.json(
      { error: "At least two file_ids are required to stitch." },
      { status: 400 }
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
    upstream = await fetch(`${base}/api/stitch-only-from-drive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        file_ids: fileIds,
        client_correlation_id: correlationId,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Cannot reach Video to Short API at ${base}. ${msg}` },
      { status: 502 }
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
