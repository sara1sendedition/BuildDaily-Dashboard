import { v4 as uuidv4 } from "uuid";
import type { ScheduledCarouselPost } from "@/context/schedule-context";
import { coerceFirstCommentField } from "@/lib/default-first-comment";
import { postToHubBody } from "@/lib/schedule/hub-translator";
import type { HubScheduleUpsertBody } from "@/lib/schedule/hub-server";
import {
  MAX_SLIDES_PER_CAROUSEL,
  sanitizeUploadFilenamePrefix,
  type PendingSlideUploads,
} from "@/lib/storage/bunny-upload-server";
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";

/** One carousel row accepted by POST /api/schedule/load-carousel. */
export type LoadCarouselInput = {
  /** ISO 8601 string or Unix seconds / milliseconds. */
  publishAt: string | number;
  caption: string;
  videoLabel: string;
  /** Pre-hosted Bunny (or other public CDN) slide URLs. */
  slideUrls?: string[];
  slideUrlsInstagram?: string[];
  /** Base64 PNG/JPEG slides — uploaded to Bunny before scheduling. */
  slidesBase64?: string[];
  slidesInstagramBase64?: string[];
  postToInstagram?: boolean;
  postToFacebook?: boolean;
  postToYouTube?: boolean;
  displayHook?: string;
  firstComment?: string;
  id?: string;
  queueItemId?: string;
  slideCount?: number;
};

export type ParsedLoadCarousel = {
  row: ScheduledCarouselPost;
  hubBody: HubScheduleUpsertBody;
  pendingUpload?: PendingSlideUploads;
};

function nonEmptyUrls(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const urls = v.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return urls.length > 0 ? urls : undefined;
}

function nonEmptyBase64Slides(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const slides = v.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  if (slides.length === 0) return undefined;
  if (slides.length > MAX_SLIDES_PER_CAROUSEL) return undefined;
  return slides;
}

/** Parse publishAt as Unix seconds. */
export function parsePublishAtUnix(raw: string | number): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1_000_000_000_000) return Math.floor(raw / 1000);
    if (raw > 0) return Math.floor(raw);
    return null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n > 1_000_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
    }
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
  }
  return null;
}

function fieldLabel(index: number, batchMode: boolean): string {
  return batchMode ? `carousels[${index}]` : "request";
}

function slideCountForRow(
  slideUrls: string[] | undefined,
  slidesBase64: string[] | undefined,
  slidesInstagramBase64: string[] | undefined,
  explicit?: number,
): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  return Math.max(
    slideUrls?.length ?? 0,
    slidesBase64?.length ?? 0,
    slidesInstagramBase64?.length ?? 0,
    0,
  );
}

function parseOneCarousel(
  raw: unknown,
  index: number,
  batchMode: boolean,
): { ok: true; value: ParsedLoadCarousel } | { ok: false; error: string } {
  const label = fieldLabel(index, batchMode);
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `${label} must be an object.` };
  }
  const o = raw as Record<string, unknown>;

  const publishAtUnix = parsePublishAtUnix(
    o.publishAt as string | number,
  );
  if (publishAtUnix == null) {
    return {
      ok: false,
      error: `${label}.publishAt must be an ISO date or Unix timestamp.`,
    };
  }

  const caption = typeof o.caption === "string" ? o.caption.trim() : "";
  if (!caption) {
    return { ok: false, error: `${label}.caption is required.` };
  }

  const videoLabel =
    typeof o.videoLabel === "string" ? o.videoLabel.trim() : "";
  if (!videoLabel) {
    return { ok: false, error: `${label}.videoLabel is required.` };
  }

  const slideUrls = nonEmptyUrls(o.slideUrls);
  const slideUrlsInstagram = nonEmptyUrls(o.slideUrlsInstagram);
  const slidesBase64 = nonEmptyBase64Slides(o.slidesBase64);
  const slidesInstagramBase64 = nonEmptyBase64Slides(o.slidesInstagramBase64);

  if (
    Array.isArray(o.slidesBase64) &&
    o.slidesBase64.length > MAX_SLIDES_PER_CAROUSEL
  ) {
    return {
      ok: false,
      error: `${label}.slidesBase64 must have at most ${MAX_SLIDES_PER_CAROUSEL} items.`,
    };
  }
  if (
    Array.isArray(o.slidesInstagramBase64) &&
    o.slidesInstagramBase64.length > MAX_SLIDES_PER_CAROUSEL
  ) {
    return {
      ok: false,
      error: `${label}.slidesInstagramBase64 must have at most ${MAX_SLIDES_PER_CAROUSEL} items.`,
    };
  }

  const hasSlideSource =
    slideUrls ||
    slideUrlsInstagram ||
    slidesBase64 ||
    slidesInstagramBase64;
  if (!hasSlideSource) {
    return {
      ok: false,
      error: `${label} must include slideUrls, slideUrlsInstagram, slidesBase64, and/or slidesInstagramBase64.`,
    };
  }

  const id =
    typeof o.id === "string" && o.id.trim().length > 0
      ? o.id.trim()
      : uuidv4();
  const queueItemId =
    typeof o.queueItemId === "string" && o.queueItemId.trim().length > 0
      ? o.queueItemId.trim()
      : id;

  const bunnyUrls: BunnyAssetUrls = {
    ...(slideUrls ? { slideUrls } : {}),
    ...(slideUrlsInstagram ? { slideUrlsInstagram } : {}),
  };

  const pendingUpload: PendingSlideUploads | undefined =
    slidesBase64 || slidesInstagramBase64
      ? {
          filenamePrefix: sanitizeUploadFilenamePrefix(videoLabel, id),
          ...(slidesBase64 ? { slidesBase64 } : {}),
          ...(slidesInstagramBase64 ? { slidesInstagramBase64 } : {}),
        }
      : undefined;

  const slideCount = slideCountForRow(
    slideUrls,
    slidesBase64,
    slidesInstagramBase64,
    typeof o.slideCount === "number" ? o.slideCount : undefined,
  );

  const row: ScheduledCarouselPost = {
    id,
    queueItemId,
    videoLabel,
    publishAtUnix,
    caption,
    postToInstagram: o.postToInstagram !== false,
    postToFacebook: o.postToFacebook !== false,
    createdAt: Date.now(),
    scheduleKind: "carousel",
    ...(slideCount > 0 ? { slideCount } : {}),
    ...(typeof o.displayHook === "string" && o.displayHook.trim()
      ? { displayHook: o.displayHook.trim() }
      : {}),
    ...(Object.keys(bunnyUrls).length > 0 ? { bunnyUrls } : {}),
    ...(o.postToYouTube === true ? { postToYouTube: true } : {}),
    ...(() => {
      const fc = coerceFirstCommentField(
        typeof o.firstComment === "string" ? o.firstComment : undefined,
      );
      return fc ? { firstComment: fc } : {};
    })(),
  };

  return {
    ok: true,
    value: buildParsedLoadCarousel(row, pendingUpload),
  };
}

/** Rebuild hub wire body after Bunny URLs are resolved. */
export function buildParsedLoadCarousel(
  row: ScheduledCarouselPost,
  pendingUpload?: PendingSlideUploads,
): ParsedLoadCarousel {
  const hub = postToHubBody(row);
  return {
    row,
    pendingUpload,
    hubBody: {
      ...hub,
      payload: hub.payload as unknown as Record<string, unknown>,
    },
  };
}

/** Normalize request JSON into one or more carousel inputs. */
export function parseLoadCarouselRequest(body: unknown):
  | { ok: true; items: ParsedLoadCarousel[] }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const o = body as Record<string, unknown>;
  let rawItems: unknown[];
  let batchMode = false;

  if (Array.isArray(o.carousels)) {
    batchMode = true;
    if (o.carousels.length === 0 && o.publishAt != null) {
      rawItems = [body];
      batchMode = false;
    } else {
      rawItems = o.carousels;
    }
  } else if (o.publishAt != null) {
    rawItems = [body];
  } else {
    return {
      ok: false,
      error:
        'Send `{ "carousels": [ … ] }` or a single carousel object with `publishAt`.',
    };
  }

  if (rawItems.length === 0) {
    return { ok: false, error: "`carousels` must contain at least one item." };
  }
  if (rawItems.length > 50) {
    return { ok: false, error: "At most 50 carousels per request." };
  }

  const items: ParsedLoadCarousel[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const parsed = parseOneCarousel(rawItems[i], i, batchMode);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }

  return { ok: true, items };
}
