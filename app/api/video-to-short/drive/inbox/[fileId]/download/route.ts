import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 600;

function resolveFileId(
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
  context: { params: Promise<{ fileId: string | string[] }> }
) {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled.", disabled: true },
      { status: 503 }
    );
  }

  const resolved = await context.params;
  const fileId = resolveFileId(resolved.fileId);
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id." }, { status: 400 });
  }

  const base = getVideoToShortApiBaseUrl();
  let upstream: Response;
  try {
    upstream = await fetch(
      `${base}/api/drive/inbox/${encodeURIComponent(fileId)}/download`,
      { cache: "no-store" }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Cannot reach Video to Short API at ${base}. ${msg}` },
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
  const cd = upstream.headers.get("content-disposition");
  if (cd) headers.set("Content-Disposition", cd);
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);
  headers.set("Cache-Control", "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
