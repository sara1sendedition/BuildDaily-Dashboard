import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { mintStitchUploadJwt } from "@/lib/mint-stitch-upload-jwt";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
// Stitching can take a while when concatenating multiple long clips because
// every input is decoded + re-encoded. 10 minutes is a generous ceiling for
// the proxy itself; the actual pipeline runs async on the backend.
export const maxDuration = 600;

/**
 * Multi-clip upload pass-through proxy. The frontend's "Stitch" tab POSTs N
 * files (with field name `files`, in the order the user wants them stitched)
 * plus the same studio/hook/editorial fields the single-file flow uses.
 *
 * Streams the multipart body verbatim to FastAPI without buffering — see the
 * single-file `/api/video-to-short/jobs/route.ts` for why (avoids hundreds of
 * MB of memory churn on every upload). The small fields the proxy used to
 * inject (`audio_mode`, `editorial_notes` baseline) are now set client-side.
 */
export async function POST(req: NextRequest) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 }
    );
  }

  const base = getVideoToShortApiBaseUrl();
  const ct = req.headers.get("content-type");
  if (!ct || !ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data body." },
      { status: 400 }
    );
  }
  if (!req.body) {
    return NextResponse.json(
      { error: "Missing request body." },
      { status: 400 }
    );
  }

  let authorization = req.headers.get("authorization")?.trim() ?? "";
  if (!authorization) {
    const secret = process.env.STITCH_UPLOAD_SECRET?.trim();
    const { userId } = await auth();
    if (secret && userId) {
      authorization = `Bearer ${mintStitchUploadJwt(secret, userId)}`;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/jobs/stitch`, {
      method: "POST",
      headers: {
        "Content-Type": ct,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: req.body,
      duplex: "half",
    } as any);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Cannot reach Video to Short API at ${base} for stitch. ${msg}`,
      },
      { status: 502 }
    );
  }

  const text = await upstream.text();
  const respCt = upstream.headers.get("content-type") || "application/json";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": respCt },
  });
}
