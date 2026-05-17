import { NextResponse } from "next/server";
import { isYoutubeRefreshConfigured } from "@/lib/youtube/access-token";

export const runtime = "nodejs";

/** Whether server-side YouTube upload is configured (no secrets returned). */
export async function GET() {
  return NextResponse.json({ configured: isYoutubeRefreshConfigured() });
}
