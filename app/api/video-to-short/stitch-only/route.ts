import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { mintStitchUploadJwt } from "@/lib/mint-stitch-upload-jwt";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
// Stitching can take a while when concatenating multiple long clips because
// every input is decoded + re-encoded. 10 minutes is a generous ceiling.
export const maxDuration = 600;

/**
 * Stitch-only proxy. Used by the /stitch page to concatenate N clips into
 * a single MP4 and stream it back. The page then stashes that MP4 in
 * IndexedDB and redirects to the home page, which runs the normal Short +
 * Carousel + Image post + X/Threads pipeline (all four formats in parallel).
 *
 * No pipeline runs on the backend for this endpoint — see /api/jobs/stitch
 * if you want stitch+pipeline in one go.
 */
export async function POST(req: NextRequest) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 }
    );
  }

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
  }

  const base = getVideoToShortApiBaseUrl();

  // Browser may POST here with `Authorization: Bearer <jwt>` when
  // NEXT_PUBLIC_STITCH_UPLOAD_URL points at this Next proxy. Forward it to
  // FastAPI — otherwise the upstream sees no bearer and returns 401.
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
    upstream = await fetch(`${base}/api/stitch-only`, {
      method: "POST",
      body: fd,
      ...(authorization
        ? { headers: { Authorization: authorization } }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Cannot reach Video to Short API at ${base} for stitch-only. ${msg}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: text || "Stitch failed" },
      { status: upstream.status }
    );
  }

  const ct = upstream.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await upstream.json();
    return NextResponse.json(body, { status: 200 });
  }

  // Legacy sync path: binary MP4 streamed straight through.
  const headers = new Headers();
  if (ct) headers.set("Content-Type", ct);
  const cd = upstream.headers.get("content-disposition");
  if (cd) headers.set("Content-Disposition", cd);
  headers.set("Cache-Control", "no-store");

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  });
}
