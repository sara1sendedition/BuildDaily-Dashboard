import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

/**
 * Recovery proxy: looks up a Short job by the client-supplied correlation id
 * the upload was started with. Used when the upload response was lost (tab
 * backgrounded mid-fetch, mobile suspend) so the client never learned the
 * assigned jobId. Mirrors the proxy shape of `/jobs/[jobId]`.
 */

function resolveCorrelationId(
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
  context: { params: Promise<{ correlationId: string | string[] }> }
) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 }
    );
  }

  const resolved = await context.params;
  const correlationId = resolveCorrelationId(resolved.correlationId);
  if (!correlationId) {
    return NextResponse.json(
      { error: "Missing correlation id." },
      { status: 400 }
    );
  }

  const base = getVideoToShortApiBaseUrl();
  let upstream: Response;
  try {
    upstream = await fetch(
      `${base}/api/jobs/by-correlation-id/${encodeURIComponent(correlationId)}`,
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
