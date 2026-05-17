import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Pure pass-through proxy: streams the incoming multipart body directly to
 * FastAPI without parsing it.
 *
 * The previous implementation called `await req.formData()` which buffers the
 * entire body into Node memory, then constructed a fresh FormData via the
 * `rewriteVideoToShortProxyFormData` helper, then re-serialized to multipart
 * for the upstream fetch. For an 80 MB iPhone clip that's roughly 250 MB of
 * memory churn and many seconds of CPU before the backend even sees a byte —
 * the upload appeared "stuck" because the proxy was busy serializing while
 * the user waited. We now stream the body verbatim; the small fields the
 * proxy used to inject (`audio_mode`, `editorial_notes` baseline) are now
 * set client-side in `lib/run-video-to-short.ts`.
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

  let upstream: Response;
  try {
    // `duplex: "half"` is required by undici when fetch body is a stream.
    // It's not yet in the standard RequestInit DOM types, so cast.
    upstream = await fetch(`${base}/api/jobs`, {
      method: "POST",
      // The original Content-Type carries the multipart boundary; preserving
      // it byte-for-byte is what makes pass-through work.
      headers: { "Content-Type": ct },
      body: req.body,
      duplex: "half",
    } as any);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Cannot reach Video to Short API at ${base}. ${msg}`,
      },
      { status: 502 }
    );
  }

  const text = await upstream.text();
  const respCt =
    upstream.headers.get("content-type") || "application/json";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": respCt },
  });
}
