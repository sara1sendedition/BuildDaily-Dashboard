"use client";

import { clientApiPath } from "@/lib/client-api-path";
import type { ScheduledCarouselPost } from "@/context/schedule-context";
import {
  hubToScheduledPost,
  postToHubBody,
  type HubScheduleEntry,
} from "./hub-translator";

/**
 * Browser-side client for the Multiplier → Hub schedule proxy.
 *
 * All calls go to local `/api/hub/schedule/*` routes (same origin, Clerk
 * cookie auth). Those routes forward to the Hub's `/api/v1/schedule/*` with
 * a fresh Clerk JWT. See `app/api/hub/schedule/route.ts`.
 */

export type HubClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function parseProblem(res: Response): Promise<string> {
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
    return `Hub returned ${res.status}: ${text.slice(0, 200)}`;
  }
}

/** GET /api/hub/schedule — list all of the current user's entries. */
export async function listScheduledPostsFromHub(): Promise<
  HubClientResult<ScheduledCarouselPost[]>
> {
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/hub/schedule"), {
      method: "GET",
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message:
        e instanceof Error ? `Network error: ${e.message}` : "Network error.",
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: await parseProblem(res) };
  }
  let body: { data?: HubScheduleEntry[] };
  try {
    body = (await res.json()) as { data?: HubScheduleEntry[] };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Hub returned invalid JSON.",
    };
  }
  const list = Array.isArray(body.data) ? body.data : [];
  const items = list.map(hubToScheduledPost);
  items.sort((a, b) => a.publishAtUnix - b.publishAtUnix);
  return { ok: true, data: items };
}

/** POST /api/hub/schedule — upsert one entry. */
export async function upsertScheduledPostToHub(
  row: ScheduledCarouselPost,
): Promise<HubClientResult<ScheduledCarouselPost>> {
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/hub/schedule"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postToHubBody(row)),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message:
        e instanceof Error ? `Network error: ${e.message}` : "Network error.",
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: await parseProblem(res) };
  }
  let body: { data?: HubScheduleEntry };
  try {
    body = (await res.json()) as { data?: HubScheduleEntry };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Hub returned invalid JSON.",
    };
  }
  if (!body.data) {
    return {
      ok: false,
      status: res.status,
      message: "Hub upsert response missing `data`.",
    };
  }
  return { ok: true, data: hubToScheduledPost(body.data) };
}

/** DELETE /api/hub/schedule/[id] */
export async function deleteScheduledPostFromHub(
  id: string,
): Promise<HubClientResult<true>> {
  let res: Response;
  try {
    res = await fetch(
      clientApiPath(`/api/hub/schedule/${encodeURIComponent(id)}`),
      {
        method: "DELETE",
      },
    );
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message:
        e instanceof Error ? `Network error: ${e.message}` : "Network error.",
    };
  }
  if (res.status === 204 || res.ok) {
    return { ok: true, data: true };
  }
  return { ok: false, status: res.status, message: await parseProblem(res) };
}
