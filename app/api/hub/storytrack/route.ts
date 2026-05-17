import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { storytrackApiUrl } from "@/lib/hub/env";

export const runtime = "nodejs";

export async function GET() {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.HUB_STORYTRACK_SECRET?.trim();
  const storytrackUserId =
    (sessionClaims?.publicMetadata as { storytrackUserId?: string } | undefined)
      ?.storytrackUserId?.trim() ||
    process.env.HUB_STORYTRACK_USER_ID?.trim();

  if (!secret || !storytrackUserId) {
    return NextResponse.json({
      linked: false,
      summary: null,
    });
  }

  const apiBase = storytrackApiUrl();
  try {
    const url = new URL(`${apiBase}/api/hub/summary`);
    url.searchParams.set("userId", storytrackUserId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        linked: true,
        summary: null,
        error: `StoryTrack ${res.status}`,
      });
    }
    const summary = await res.json();
    return NextResponse.json({ linked: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({
      linked: true,
      summary: null,
      error: msg,
    });
  }
}
