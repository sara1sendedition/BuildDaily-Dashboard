import { NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

export async function GET() {
  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json({
      ok: false,
      drive_inbox_configured: false,
    });
  }

  const base = getVideoToShortApiBaseUrl();
  try {
    const upstream = await fetch(`${base}/api/health`, { cache: "no-store" });
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
      { ok: false, error: msg, drive_inbox_configured: false },
      { status: 502 }
    );
  }
}
