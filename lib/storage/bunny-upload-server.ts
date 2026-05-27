/**
 * Server-side Bunny.net Storage uploads via the Hub upload-token flow.
 * Used by `/api/schedule/load-carousel` when callers send base64 slides
 * instead of pre-hosted CDN URLs.
 */

import {
  DAEMON_USER_ID_ERROR,
  getHubBase,
  resolveDaemonScheduleUserId,
  type HubFetchResult,
} from "@/lib/schedule/hub-server";
import type { ScheduleApiAuth } from "@/lib/schedule/schedule-api-auth";
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";

export type BunnyUploadToken = {
  provider: "bunny-stream" | "bunny-storage";
  uploadUrl: string;
  storagePath: string;
  headers: Record<string, string>;
  expiresAt: string;
  playbackUrl: string;
};

/** Max slides per carousel field (square or Instagram set). */
export const MAX_SLIDES_PER_CAROUSEL = 20;

/** Max decoded bytes per slide (~10 MB). */
export const MAX_SLIDE_BYTES = 10 * 1024 * 1024;

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

type MintTokenBody = {
  kind: "thumbnail";
  filename: string;
  contentType: string;
  userId?: string;
};

export async function mintBunnyUploadToken(
  auth: ScheduleApiAuth,
  body: Omit<MintTokenBody, "userId">,
  explicitUserId?: string,
): Promise<HubFetchResult<BunnyUploadToken>> {
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
      ? "/api/v1/internal/storage/upload-token"
      : "/api/v1/storage/upload-token";
  const authorization =
    auth.mode === "daemon"
      ? `Bearer ${auth.secret}`
      : `Bearer ${auth.token}`;

  const payload: MintTokenBody = { ...body };
  if (auth.mode === "daemon") {
    const userId = resolveDaemonScheduleUserId(explicitUserId);
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
          ? `${message} Hub must expose POST /api/v1/internal/storage/upload-token for daemon uploads.`
          : message,
    };
  }

  try {
    const j = (await res.json()) as { data?: BunnyUploadToken };
    if (!j.data?.uploadUrl || !j.data.playbackUrl) {
      return {
        ok: false,
        status: res.status,
        message: "Hub upload-token response missing uploadUrl or playbackUrl.",
      };
    }
    return { ok: true, data: j.data };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Hub returned invalid JSON for upload-token.",
    };
  }
}

/** Decode a raw base64 or data-URL PNG/JPEG string to a Buffer. */
export function decodeImageBase64(
  raw: string,
): { buffer: Buffer; contentType: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(trimmed);
  const contentType = m ? m[1]!.toLowerCase() : "image/png";
  const b64 = m ? m[2]! : trimmed;
  if (!/^image\/(png|jpe?g|webp)$/i.test(contentType)) {
    return null;
  }
  const normalized = b64.replace(/\s/g, "");
  if (
    normalized.length === 0 ||
    !/^[A-Za-z0-9+/]+=*$/.test(normalized)
  ) {
    return null;
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0 || buffer.length > MAX_SLIDE_BYTES) {
    return null;
  }
  return { buffer, contentType };
}

export async function uploadBufferToBunnyStorage(
  buffer: Buffer,
  opts: { filename: string; contentType: string },
  auth: ScheduleApiAuth,
  explicitUserId?: string,
): Promise<HubFetchResult<string>> {
  const token = await mintBunnyUploadToken(
    auth,
    {
      kind: "thumbnail",
      filename: opts.filename,
      contentType: opts.contentType,
    },
    explicitUserId,
  );
  if (!token.ok) return token;

  let res: Response;
  try {
    res = await fetch(token.data.uploadUrl, {
      method: "PUT",
      headers: {
        ...token.data.headers,
        "Content-Type": opts.contentType,
      },
      body: new Uint8Array(buffer),
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message:
        e instanceof Error
          ? `Bunny PUT failed: ${e.message}`
          : "Bunny PUT failed.",
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      message: `Bunny PUT failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    };
  }

  return { ok: true, data: token.data.playbackUrl };
}

export async function uploadSlidesBase64ToBunny(
  slides: string[],
  opts: { prefix: string; suffix?: string },
  auth: ScheduleApiAuth,
  explicitUserId?: string,
): Promise<HubFetchResult<string[]>> {
  if (slides.length === 0) {
    return { ok: true, data: [] };
  }
  if (slides.length > MAX_SLIDES_PER_CAROUSEL) {
    return {
      ok: false,
      status: 400,
      message: `At most ${MAX_SLIDES_PER_CAROUSEL} slides per upload field.`,
    };
  }

  const suffix = opts.suffix ?? "";
  const urls: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const decoded = decodeImageBase64(slides[i]!);
    if (!decoded) {
      return {
        ok: false,
        status: 400,
        message: `Slide ${i + 1} is not valid base64 PNG/JPEG/WebP (max ${MAX_SLIDE_BYTES} bytes decoded).`,
      };
    }
    const ext =
      decoded.contentType.includes("jpeg") || decoded.contentType.includes("jpg")
        ? "jpg"
        : decoded.contentType.includes("webp")
          ? "webp"
          : "png";
    const uploaded = await uploadBufferToBunnyStorage(
      decoded.buffer,
      {
        filename: `${opts.prefix}${suffix}-${String(i + 1).padStart(2, "0")}.${ext}`,
        contentType: decoded.contentType,
      },
      auth,
      explicitUserId,
    );
    if (!uploaded.ok) return uploaded;
    urls.push(uploaded.data);
  }
  return { ok: true, data: urls };
}

export type PendingSlideUploads = {
  slidesBase64?: string[];
  slidesInstagramBase64?: string[];
  filenamePrefix: string;
};

export function sanitizeUploadFilenamePrefix(
  videoLabel: string,
  id: string,
): string {
  const slug = videoLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const safeSlug = slug.length > 0 ? slug : "carousel";
  return `${safeSlug}-${id.slice(0, 8)}`;
}

/** Upload pending base64 slides and merge with any pre-supplied CDN URLs. */
export async function resolveCarouselBunnyUrls(
  existing: BunnyAssetUrls | undefined,
  pending: PendingSlideUploads | undefined,
  auth: ScheduleApiAuth,
  explicitUserId?: string,
): Promise<HubFetchResult<BunnyAssetUrls>> {
  const merged: BunnyAssetUrls = { ...(existing ?? {}) };

  if (pending?.slidesBase64?.length) {
    const uploaded = await uploadSlidesBase64ToBunny(
      pending.slidesBase64,
      { prefix: pending.filenamePrefix, suffix: "" },
      auth,
      explicitUserId,
    );
    if (!uploaded.ok) return uploaded;
    merged.slideUrls = uploaded.data;
  }

  if (pending?.slidesInstagramBase64?.length) {
    const uploaded = await uploadSlidesBase64ToBunny(
      pending.slidesInstagramBase64,
      { prefix: pending.filenamePrefix, suffix: "-ig" },
      auth,
      explicitUserId,
    );
    if (!uploaded.ok) return uploaded;
    merged.slideUrlsInstagram = uploaded.data;
  }

  const hasSlides =
    (merged.slideUrls?.length ?? 0) > 0 ||
    (merged.slideUrlsInstagram?.length ?? 0) > 0;
  if (!hasSlides) {
    return {
      ok: false,
      status: 400,
      message:
        "Provide `slideUrls`, `slideUrlsInstagram`, `slidesBase64`, and/or `slidesInstagramBase64` with at least one slide.",
    };
  }

  // Publish path uses slideUrlsInstagram for IG-only posts. When callers send
  // square slides only, mirror them so Instagram scheduling still works.
  if (
    (merged.slideUrls?.length ?? 0) > 0 &&
    !(merged.slideUrlsInstagram?.length ?? 0)
  ) {
    merged.slideUrlsInstagram = merged.slideUrls;
  }

  return { ok: true, data: merged };
}
