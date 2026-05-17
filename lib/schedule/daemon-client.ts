"use client";

import { clientApiPath } from "@/lib/client-api-path";
import type { DaemonScheduleEntry } from "./daemon-schema";

function secret(): string | undefined {
  return process.env.NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET?.trim() || undefined;
}

/** Subset of daemon row returned by GET /api/schedule/daemon-status (no images). */
export type DaemonPublishRowStatus = {
  id: string;
  publishAtUnix: number;
  daemonPublishedAt?: number;
  daemonLastError?: string;
};

/** Returns null if daemon secret is not configured or the request fails. */
export async function fetchDaemonStatuses(): Promise<DaemonPublishRowStatus[] | null> {
  const s = secret();
  if (!s) return null;
  try {
    const res = await fetch(clientApiPath("/api/schedule/daemon-status"), {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${s}` },
    });
    if (!res.ok) {
      console.warn("[daemon-status]", res.status, await res.text());
      return null;
    }
    const j = (await res.json()) as { entries?: DaemonPublishRowStatus[] };
    return Array.isArray(j.entries) ? j.entries : [];
  } catch (e) {
    console.warn("[daemon-status]", e);
    return null;
  }
}

/** No-op if NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET is unset (daemon disabled). */
export async function syncDaemonUpsert(entry: DaemonScheduleEntry): Promise<void> {
  const s = secret();
  if (!s) return;
  try {
    const res = await fetch(clientApiPath("/api/schedule/daemon-upsert"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s}`,
      },
      body: JSON.stringify({ entry }),
    });
    if (!res.ok) {
      console.warn("[daemon-upsert]", res.status, await res.text());
    }
  } catch (e) {
    console.warn("[daemon-upsert]", e);
  }
}

/** Multipart reel upload; no-op if `NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET` is unset. */
export async function syncDaemonUpsertReel(
  entry: DaemonScheduleEntry,
  video: File
): Promise<void> {
  const s = secret();
  if (!s) return;
  const payload: DaemonScheduleEntry = {
    ...entry,
    scheduleKind: "short",
    publishSlidesBase64: undefined,
    reelVideoStored: undefined,
  };
  const form = new FormData();
  form.set("entry", JSON.stringify(payload));
  form.set("video", video, video.name || "reel.mp4");
  try {
    const res = await fetch(clientApiPath("/api/schedule/daemon-upsert-reel"), {
      method: "POST",
      headers: { Authorization: `Bearer ${s}` },
      body: form,
    });
    if (!res.ok) {
      console.warn("[daemon-upsert-reel]", res.status, await res.text());
    }
  } catch (e) {
    console.warn("[daemon-upsert-reel]", e);
  }
}

export async function syncDaemonDelete(id: string): Promise<void> {
  const s = secret();
  if (!s) return;
  try {
    const res = await fetch(clientApiPath("/api/schedule/daemon-delete"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s}`,
      },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      console.warn("[daemon-delete]", res.status, await res.text());
    }
  } catch (e) {
    console.warn("[daemon-delete]", e);
  }
}
