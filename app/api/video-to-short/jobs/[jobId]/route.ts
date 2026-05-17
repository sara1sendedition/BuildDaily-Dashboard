import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

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
  let upstream: Response;
  try {
    upstream = await fetch(
      `${base}/api/jobs/${encodeURIComponent(jobId)}`,
      { cache: "no-store" }
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
  const ct = upstream.headers.get("content-type") || "application/json";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": ct },
  });
}
