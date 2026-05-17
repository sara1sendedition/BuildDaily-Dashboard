import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { readDaemonSchedule } from "@/lib/schedule/daemon-store";
import { getMetaEnv } from "@/lib/meta/publish";
import { isYoutubeRefreshConfigured } from "@/lib/youtube/access-token";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

async function probeShortBackend(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/openapi.json`, {
      method: "GET",
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const daemon = await readDaemonSchedule();
  const daemonUpcoming = daemon.filter(
    (e) => !e.daemonPublishedAt && e.publishAtUnix > nowUnix
  ).length;
  const postsPublished = daemon.filter((e) => e.daemonPublishedAt).length;

  const metaConfigured = getMetaEnv() !== null;
  const youtubeConfigured = isYoutubeRefreshConfigured();
  let shortBackendOk = false;
  if (isVideoToShortIntegrationEnabled()) {
    shortBackendOk = await probeShortBackend(getVideoToShortApiBaseUrl());
  }

  return NextResponse.json({
    daemonUpcoming,
    postsPublished,
    metaConfigured,
    youtubeConfigured,
    shortBackendOk,
  });
}
