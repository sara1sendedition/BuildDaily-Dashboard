/**
 * Server-side Hub helpers for schedule routes (publish daemon, load-carousel API).
 */

import type { HubScheduleEntry } from "@/lib/schedule/hub-translator";

export function getHubBase(): string | null {
  const raw = process.env.HUB_API_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

export function getScheduleImportUserId(): string | null {
  const raw =
    process.env.SCHEDULE_IMPORT_USER_ID?.trim() ||
    process.env.HUB_SCHEDULE_USER_ID?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Resolve target Clerk user for daemon-authenticated schedule writes. */
export function resolveDaemonScheduleUserId(
  explicitUserId?: string | null,
): string | null {
  const fromRequest = explicitUserId?.trim();
  if (fromRequest) return fromRequest;
  return getScheduleImportUserId();
}

const DAEMON_USER_ID_ERROR =
  "Set SCHEDULE_IMPORT_USER_ID in server env or pass `userId` in the request when using daemon auth.";

export { DAEMON_USER_ID_ERROR };

export type HubScheduleUpsertBody = {
  id: string;
  scheduleKind: "post" | "reel" | "short";
  publishAt: string;
  payload: Record<string, unknown>;
  userId?: string;
};

export type HubFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

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

/** Upsert one schedule row on the Hub (Clerk JWT or daemon shared secret). */
export async function upsertScheduleEntryOnHub(
  body: HubScheduleUpsertBody,
  auth: { mode: "clerk"; token: string } | { mode: "daemon"; secret: string },
): Promise<HubFetchResult<HubScheduleEntry>> {
  const base = getHubBase();
  if (!base) {
    return {
      ok: false,
      status: 503,
      message:
        "HUB_API_URL is not set. Add it to your deployment env (e.g. https://hub.builddaily.app).",
    };
  }

  const path =
    auth.mode === "daemon"
      ? "/api/v1/internal/schedule"
      : "/api/v1/schedule";
  const authorization =
    auth.mode === "daemon"
      ? `Bearer ${auth.secret}`
      : `Bearer ${auth.token}`;

  const payload = { ...body };
  if (auth.mode === "daemon") {
    const userId = resolveDaemonScheduleUserId(payload.userId);
    if (!userId) {
      return { ok: false, status: 400, message: DAEMON_USER_ID_ERROR };
    }
    payload.userId = userId;
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message:
        e instanceof Error ? `Hub fetch failed: ${e.message}` : "Hub fetch failed.",
    };
  }

  if (!res.ok) {
    const message = await parseHubProblem(res);
    return {
      ok: false,
      status: res.status,
      message:
        auth.mode === "daemon" && res.status === 404
          ? `${message} Hub must expose POST /api/v1/internal/schedule for daemon upserts.`
          : message,
    };
  }

  try {
    const j = (await res.json()) as { data?: HubScheduleEntry };
    if (!j.data) {
      return {
        ok: false,
        status: res.status,
        message: "Hub upsert response missing `data`.",
      };
    }
    return { ok: true, data: j.data };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Hub returned invalid JSON.",
    };
  }
}

/** List schedule rows for the authenticated Hub user. */
export async function listScheduleEntriesOnHub(
  auth: { mode: "clerk"; token: string } | { mode: "daemon"; secret: string },
  opts?: { unposted?: boolean; userId?: string },
): Promise<HubFetchResult<HubScheduleEntry[]>> {
  const base = getHubBase();
  if (!base) {
    return {
      ok: false,
      status: 503,
      message: "HUB_API_URL is not set.",
    };
  }

  const path =
    auth.mode === "daemon"
      ? "/api/v1/internal/schedule"
      : "/api/v1/schedule";
  const authorization =
    auth.mode === "daemon"
      ? `Bearer ${auth.secret}`
      : `Bearer ${auth.token}`;

  const url = new URL(`${base}${path}`);
  if (opts?.unposted) url.searchParams.set("unposted", "1");
  let userId: string | null = null;
  if (auth.mode === "daemon") {
    userId = resolveDaemonScheduleUserId(opts?.userId);
    if (!userId) {
      return { ok: false, status: 400, message: DAEMON_USER_ID_ERROR };
    }
    url.searchParams.set("userId", userId);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: authorization },
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message:
        e instanceof Error ? `Hub fetch failed: ${e.message}` : "Hub fetch failed.",
    };
  }

  if (!res.ok) {
    const message = await parseHubProblem(res);
    return {
      ok: false,
      status: res.status,
      message:
        auth.mode === "daemon" && res.status === 404
          ? `${message} Hub must expose GET /api/v1/internal/schedule for daemon list.`
          : message,
    };
  }

  try {
    const j = (await res.json()) as { data?: HubScheduleEntry[] };
    const list = Array.isArray(j.data) ? j.data : [];
    return { ok: true, data: list };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Hub returned invalid JSON.",
    };
  }
}
