"use client";

import { clientApiPath } from "@/lib/client-api-path";

function secret(): string | undefined {
  return process.env.NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET?.trim() || undefined;
}

/**
 * Per-row publish state for calendar badges.
 *
 * Phase 4.C — the underlying data source moved from
 * `.data/daemon-schedule.json` to the Hub. This helper now derives the
 * shape from `GET /api/hub/schedule` (which proxies to the Hub) so the
 * existing calendar UI keeps working without code changes upstream.
 */
export type DaemonPublishRowStatus = {
  id: string;
  publishAtUnix: number;
  daemonPublishedAt?: number;
  daemonLastError?: string;
};

export async function fetchDaemonStatuses(): Promise<
  DaemonPublishRowStatus[] | null
> {
  try {
    const res = await fetch(clientApiPath("/api/hub/schedule"), {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[schedule-status]", res.status, await res.text());
      return null;
    }
    const j = (await res.json()) as {
      data?: Array<{
        id: string;
        publishAt: string;
        postedAt: string | null;
        error: string | null;
      }>;
    };
    const rows = Array.isArray(j.data) ? j.data : [];
    return rows.map((r) => ({
      id: r.id,
      publishAtUnix: Math.floor(new Date(r.publishAt).getTime() / 1000),
      ...(r.postedAt
        ? { daemonPublishedAt: Math.floor(new Date(r.postedAt).getTime() / 1000) }
        : {}),
      ...(r.error ? { daemonLastError: r.error } : {}),
    }));
  } catch (e) {
    console.warn("[schedule-status]", e);
    return null;
  }
}

export type DaemonPublishNowResult =
  | {
      ok: true;
      alreadyPublished?: boolean;
      instagramMediaId?: string;
      facebookPostId?: string;
      youtubeVideoId?: string;
      firstCommentErrors?: string[];
      firstCommentDeferred?: boolean;
    }
  | { ok: false; status: number; message: string };

/**
 * Server-side fallback for the calendar's manual "Send to Meta" button. Publishes
 * a single scheduled post using slides / reel already persisted on the server, so
 * it works after the home-page workspace snapshot has been cleared. Returns
 * `{ ok: false, status: 503 }` when `NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET` is unset.
 */
export async function publishNowViaDaemon(
  entryId: string,
  opts: { scheduledPublishTime?: number } = {}
): Promise<DaemonPublishNowResult> {
  const s = secret();
  if (!s) {
    return {
      ok: false,
      status: 503,
      message:
        "Daemon secret is not configured in this build — set NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET to allow server-side publish.",
    };
  }
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/schedule/publish-now"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s}`,
      },
      body: JSON.stringify({
        entryId,
        ...(opts.scheduledPublishTime != null
          ? { scheduledPublishTime: opts.scheduledPublishTime }
          : {}),
      }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message:
        e instanceof Error ? e.message : "Network error contacting publish-now.",
    };
  }
  const raw = await res.text();
  let data: {
    ok?: boolean;
    alreadyPublished?: boolean;
    instagramMediaId?: string;
    facebookPostId?: string;
    youtubeVideoId?: string;
    firstCommentErrors?: string[];
    firstCommentDeferred?: boolean;
    error?: string;
  };
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    return {
      ok: false,
      status: res.status,
      message: `Publish-now returned ${res.status} with invalid JSON.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: data.error ?? `Publish-now failed (${res.status}).`,
    };
  }
  return {
    ok: true,
    alreadyPublished: data.alreadyPublished === true,
    instagramMediaId: data.instagramMediaId,
    facebookPostId: data.facebookPostId,
    youtubeVideoId: data.youtubeVideoId,
    ...(Array.isArray(data.firstCommentErrors) &&
    data.firstCommentErrors.length > 0
      ? { firstCommentErrors: data.firstCommentErrors }
      : {}),
    ...(data.firstCommentDeferred === true
      ? { firstCommentDeferred: true }
      : {}),
  };
}

