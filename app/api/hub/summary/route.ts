import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getHubBase } from "@/lib/hub/get-hub-base";
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

async function fetchScheduleCountsFromHub(
  bearer: string,
): Promise<{ upcoming: number; published: number } | null> {
  const base = getHubBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/v1/schedule`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      data?: Array<{ publishAt: string; postedAt: string | null }>;
    };
    const now = Date.now();
    const rows = Array.isArray(j.data) ? j.data : [];
    let upcoming = 0;
    let published = 0;
    for (const row of rows) {
      if (row.postedAt) published += 1;
      else if (new Date(row.publishAt).getTime() > now) upcoming += 1;
    }
    return { upcoming, published };
  } catch {
    return null;
  }
}

/** Legacy `.data/daemon-schedule.json` fallback when Hub API is unreachable. */
async function fetchScheduleCountsFromDaemonFile(): Promise<{
  upcoming: number;
  published: number;
}> {
  try {
    const { readDaemonSchedule } = await import("@/lib/schedule/daemon-store");
    const nowUnix = Math.floor(Date.now() / 1000);
    const daemon = await readDaemonSchedule();
    return {
      upcoming: daemon.filter(
        (e) => !e.daemonPublishedAt && e.publishAtUnix > nowUnix,
      ).length,
      published: daemon.filter((e) => e.daemonPublishedAt).length,
    };
  } catch {
    return { upcoming: 0, published: 0 };
  }
}

export async function GET() {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getToken();
  const fromHub = token ? await fetchScheduleCountsFromHub(token) : null;
  const { upcoming: daemonUpcoming, published: postsPublished } =
    fromHub ?? (await fetchScheduleCountsFromDaemonFile());

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
