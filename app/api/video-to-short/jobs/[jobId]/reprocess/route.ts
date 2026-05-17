import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 60;

function resolveJobId(
  raw: string | string[] | undefined
): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].trim()) {
    return raw[0].trim();
  }
  return undefined;
}

/**
 * Re-run the Short pipeline on a job's stored upload. Streams the multipart
 * body verbatim to the backend (no `req.formData()` parsing) — same rationale
 * as `/api/video-to-short/jobs/route.ts`. The reprocess body is small (no
 * file upload, just form fields) but we keep the pattern consistent across
 * the three Short proxies.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string | string[] }> }
) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 }
    );
  }

  const resolved = await context.params;
  const jobId = resolveJobId(resolved.jobId);
  if (!jobId) {
    return NextResponse.json({ error: "Missing job id." }, { status: 400 });
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
    upstream = await fetch(
      `${base}/api/jobs/${encodeURIComponent(jobId)}/reprocess`,
      {
        method: "POST",
        headers: { "Content-Type": ct },
        body: req.body,
        duplex: "half",
      } as any
    );
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
  const respCt = upstream.headers.get("content-type") || "application/json";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": respCt },
  });
}
