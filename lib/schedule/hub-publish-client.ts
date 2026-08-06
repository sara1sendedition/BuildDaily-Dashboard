/**
 * Multiplier → Hub calls for publish-due / publish-now (daemon secret auth).
 */

import { getHubBase } from "@/lib/schedule/hub-server";

export type HubPublishResults = {
  instagramMediaId?: string;
  facebookPostId?: string;
  youtubeVideoId?: string;
  tiktokPublishId?: string;
};

export type HubMarkPostedBody = {
  postedAt?: string | null;
  error?: string | null;
  publishResults?: HubPublishResults;
};

function daemonSecret(): string {
  return process.env.SCHEDULE_DAEMON_SECRET?.trim() ?? "";
}

async function parseHubProblem(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `Hub returned ${res.status}.`;
  try {
    const j = JSON.parse(text) as {
      error?: string;
      detail?: string;
      title?: string;
    };
    return j.error ?? j.detail ?? j.title ?? `Hub returned ${res.status}.`;
  } catch {
    return `Hub returned ${res.status}: ${text.slice(0, 240)}`;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Soft-lock a schedule row for publishing (does not set postedAt). */
export async function claimScheduleEntryForPublishOnHub(
  id: string,
): Promise<
  | { ok: true; claimed: boolean; publishClaimedAt?: string }
  | { ok: false; message: string }
> {
  const base = getHubBase();
  const secret = daemonSecret();
  if (!base || !secret) {
    return {
      ok: false,
      message: "HUB_API_URL or SCHEDULE_DAEMON_SECRET is not configured.",
    };
  }
  try {
    const res = await fetch(
      `${base}/api/v1/internal/schedule/${encodeURIComponent(id)}/claim-publish`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, message: await parseHubProblem(res) };
    }
    const j = (await res.json()) as {
      data?: { claimed?: boolean; publishClaimedAt?: string };
    };
    return {
      ok: true,
      claimed: j.data?.claimed === true,
      publishClaimedAt: j.data?.publishClaimedAt,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? `Hub claim-publish failed: ${e.message}`
          : "Hub claim-publish failed.",
    };
  }
}

export async function markScheduleEntryPostedOnHub(
  id: string,
  body: HubMarkPostedBody,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const base = getHubBase();
  const secret = daemonSecret();
  if (!base || !secret) {
    return {
      ok: false,
      message: "HUB_API_URL or SCHEDULE_DAEMON_SECRET is not configured.",
    };
  }
  let lastMessage = "Hub mark-posted failed.";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `${base}/api/v1/internal/schedule/${encodeURIComponent(id)}/mark-posted`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        },
      );
      if (res.ok) return { ok: true };
      lastMessage = await parseHubProblem(res);
    } catch (e) {
      lastMessage =
        e instanceof Error
          ? `Hub mark-posted failed: ${e.message}`
          : "Hub mark-posted failed.";
    }
    if (attempt < 2) await sleep(400 * (attempt + 1));
  }
  return { ok: false, message: lastMessage };
}

export function warnIfHubMarkFailed(
  context: string,
  id: string,
  result: { ok: false; message: string },
): void {
  console.warn(`[${context}] Hub mark failed for ${id}:`, result.message);
}
