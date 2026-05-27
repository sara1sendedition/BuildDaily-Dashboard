"use client";

import { clientApiPath } from "@/lib/client-api-path";
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";

/**
 * Browser-side client for the Multiplier → Hub queue proxy (Phase 3).
 *
 * The Hub stores one MultiplierQueueItem per processed-video on the home
 * page (scheduled or not). The Multiplier hydrates its in-memory queue
 * from this on mount, then fires an upsert on every mutation. The shape
 * of `payload` is owned here — the Hub treats it as opaque Json.
 */

export type MultiplierQueueStatus = "processing" | "done" | "failed";
export type MultiplierQueueKind = "carousel" | "photo" | "short";

/**
 * What the Multiplier writes into / reads from the Hub `payload` Json.
 * Everything not strictly needed for the home-queue list is optional —
 * older rows (or rows from a partially-processed pipeline) may be sparse.
 */
/** Text overlay + feed caption for the single-frame image post (no base64). */
export type ImagePostCopyPayload = {
  hook?: string;
  microCta?: string;
  caption?: string;
  altText?: string;
  evidenceSegmentIds?: number[];
  frameTimeSec?: number;
};

export type MultiplierQueuePayload = {
  v: 1;
  bunnyUrls?: BunnyAssetUrls;
  socialCaption?: string;
  /** Image-post hook, subline, and Instagram caption — survives Hub sync / refresh. */
  imagePostCopy?: ImagePostCopyPayload;
  displayHook?: string;
  durationSec?: number;
  /** Carousel-only re-editable copy state. JSON-safe slim version. */
  editableSlides?: Array<{
    headline?: string;
    body?: string;
    timeSec?: number;
  }>;
  /** Transcript chunks, optional. */
  transcript?: Array<{
    id: number;
    text: string;
    startSec: number;
    endSec: number;
  }>;
  effectiveType?: string | null;
  layoutId?: string;
  carouselOverride?: string;
  /** Video to Short job id — survives Hub sync for re-process / re-download after refresh. */
  shortJobId?: string;
};

/** Wire shape of an item as returned by the Hub. */
export type HubMultiplierQueueItem = {
  id: string;
  userId: string;
  status: MultiplierQueueStatus;
  kind: MultiplierQueueKind | null;
  videoLabel: string;
  payload: MultiplierQueuePayload;
  createdAt: string;
  updatedAt: string;
};

export type HubResult<T> =
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

/** GET /api/hub/multiplier-queue — list (newest first). */
export async function listMultiplierQueueFromHub(opts?: {
  status?: MultiplierQueueStatus;
  limit?: number;
}): Promise<HubResult<HubMultiplierQueueItem[]>> {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  let res: Response;
  try {
    res = await fetch(
      clientApiPath(`/api/hub/multiplier-queue${qs ? `?${qs}` : ""}`),
      { method: "GET", cache: "no-store" },
    );
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
  let body: { data?: HubMultiplierQueueItem[] };
  try {
    body = (await res.json()) as { data?: HubMultiplierQueueItem[] };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Hub returned invalid JSON.",
    };
  }
  return { ok: true, data: Array.isArray(body.data) ? body.data : [] };
}

/** POST /api/hub/multiplier-queue — upsert. */
export async function upsertMultiplierQueueItemToHub(input: {
  id: string;
  videoLabel: string;
  status?: MultiplierQueueStatus;
  kind?: MultiplierQueueKind | null;
  payload?: MultiplierQueuePayload;
}): Promise<HubResult<HubMultiplierQueueItem>> {
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/hub/multiplier-queue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
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
  let body: { data?: HubMultiplierQueueItem };
  try {
    body = (await res.json()) as { data?: HubMultiplierQueueItem };
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
  return { ok: true, data: body.data };
}

/**
 * PATCH /api/hub/multiplier-queue/[id] — narrow update with shallow-merged
 * payload. Pass `null` for a payload field to delete it from the stored
 * Json.
 */
export async function patchMultiplierQueueItemOnHub(
  id: string,
  input: {
    status?: MultiplierQueueStatus;
    kind?: MultiplierQueueKind | null;
    videoLabel?: string;
    payload?: Partial<MultiplierQueuePayload>;
  },
): Promise<HubResult<HubMultiplierQueueItem>> {
  let res: Response;
  try {
    res = await fetch(
      clientApiPath(`/api/hub/multiplier-queue/${encodeURIComponent(id)}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
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
  if (!res.ok) {
    return { ok: false, status: res.status, message: await parseProblem(res) };
  }
  let body: { data?: HubMultiplierQueueItem };
  try {
    body = (await res.json()) as { data?: HubMultiplierQueueItem };
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
      message: "Hub patch response missing `data`.",
    };
  }
  return { ok: true, data: body.data };
}

/** DELETE /api/hub/multiplier-queue/[id] */
export async function deleteMultiplierQueueItemFromHub(
  id: string,
): Promise<HubResult<true>> {
  let res: Response;
  try {
    res = await fetch(
      clientApiPath(`/api/hub/multiplier-queue/${encodeURIComponent(id)}`),
      { method: "DELETE" },
    );
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message:
        e instanceof Error ? `Network error: ${e.message}` : "Network error.",
    };
  }
  if (res.status === 204 || res.ok) return { ok: true, data: true };
  return { ok: false, status: res.status, message: await parseProblem(res) };
}
