import { NextRequest, NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 600;

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
    upstream = await fetch(`${base}/api/drive/stitch-raw`, {
      method: "POST",
      headers: { "Content-Type": ct },
      body: req.body,
      duplex: "half",
    } as any);
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
  const ctOut = upstream.headers.get("content-type");
  if (ctOut) headers.set("Content-Type", ctOut);
  headers.set("Cache-Control", "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
