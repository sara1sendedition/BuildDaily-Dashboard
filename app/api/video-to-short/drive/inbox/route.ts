import { NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

export async function GET() {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json({ configured: false, files: [] });
  }

  const base = getVideoToShortApiBaseUrl();
  try {
    const upstream = await fetch(`${base}/api/drive/inbox`, {
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Cannot reach Video to Short API at ${base}. ${msg}` },
      { status: 502 }
    );
  }
}
