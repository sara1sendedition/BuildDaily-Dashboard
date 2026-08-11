import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 300;

function resolveJobId(
  raw: string | string[] | undefined
): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].trim()) {
    return raw[0].trim();
  }
  return undefined;
}

export async function GET(
  _req: NextRequest,
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
  // Forward Range so upstream can answer 206; without it <video> seek/play
  // breaks and edge proxies may gzip a full 200 MP4 body.
  const range = _req.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(
      `${base}/api/jobs/${encodeURIComponent(jobId)}/download`,
      { cache: "no-store", headers: range ? { Range: range } : undefined }
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

  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text();
    return new NextResponse(t, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  }

  const headers = new Headers();
  for (const h of [
    "content-type",
    "content-disposition",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("Cache-Control", "no-store, no-transform");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
