/**
 * Translate between the Multiplier's `ScheduledCarouselPost` (browser-side
 * shape, currently in localStorage) and the Hub's `ScheduleEntry` (Postgres
 * row shape per `prisma/schema.prisma`).
 *
 * The Hub's `ScheduleEntry` keeps everything that doesn't fit the four
 * top-level columns (caption, IG/FB/YT flags, thumbs, etc.) in a single
 * `payload: Json` field. That field is the single source of truth for
 * publishing — eventual Bunny URLs will land here too in Phase 2.
 */

import type { ScheduledCarouselPost } from "@/context/schedule-context";
import { coerceFirstCommentField } from "@/lib/default-first-comment";
import type { ScheduleContentKind } from "@/lib/schedule/calendar-preview-thumbs";
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";

/** Wire shape of an entry as returned by the Hub API (`/api/v1/schedule`). */
export type HubScheduleEntry = {
  id: string;
  userId: string;
  scheduleKind: "post" | "reel" | "short";
  /** ISO 8601 string with timezone. */
  publishAt: string;
  payload: HubSchedulePayload;
  reelVideoStored: boolean;
  postedAt: string | null;
  error: string | null;
  createdAt: string;
};

/** What the Multiplier writes into / reads from the Hub `payload` Json column. */
export type HubSchedulePayload = {
  /** Schema version — bump if the shape changes incompatibly. */
  v: 1;
  /** Multiplier home-queue id this entry was scheduled from (in-memory only). */
  queueItemId: string;
  videoLabel: string;
  caption: string;
  postToInstagram: boolean;
  postToFacebook: boolean;
  postToYouTube?: boolean;
  slideCount?: number;
  /** Small JPEG data URLs (max 5) — already in localStorage; kept for parity. */
  calendarThumbJpegs?: string[];
  displayHook?: string;
  /**
   * The Multiplier's ScheduleContentKind ("carousel" | "photo" | "short")
   * preserved alongside Hub's `scheduleKind` ("post" | "reel" | "short")
   * because the Multiplier UI / publish path care about carousel-vs-photo.
   */
  uiScheduleKind: ScheduleContentKind;
  /**
   * Phase 2.0 / 2.1 Bunny.net URLs for slide PNGs / image-post JPEG / reel
   * MP4. Populated when the home-page workspace uploads them post-processing.
   * When present, the publish path fetches from these URLs server-side
   * instead of base64 from `.data/daemon-schedule.json` or MP4 bytes from
   * `.data/daemon-reels/{id}.mp4`.
   */
  slideUrls?: string[];
  slideUrlsInstagram?: string[];
  imagePostUrl?: string;
  reelMp4Url?: string;
  /** Optional text posted as a first comment after publish (not pinned via API). */
  firstComment?: string;
};

function nonEmptyUrlStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const urls = v.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return urls.length > 0 ? urls : undefined;
}

function bunnyUrlsFromFlatFields(
  p: Record<string, unknown>,
): BunnyAssetUrls | undefined {
  const slideUrls = nonEmptyUrlStrings(p.slideUrls);
  const slideUrlsInstagram = nonEmptyUrlStrings(p.slideUrlsInstagram);
  const imagePostUrl =
    typeof p.imagePostUrl === "string" && p.imagePostUrl.trim().length > 0
      ? p.imagePostUrl.trim()
      : undefined;
  const reelMp4Url =
    typeof p.reelMp4Url === "string" && p.reelMp4Url.trim().length > 0
      ? p.reelMp4Url.trim()
      : undefined;
  if (!slideUrls && !slideUrlsInstagram && !imagePostUrl && !reelMp4Url) {
    return undefined;
  }
  return {
    ...(slideUrls ? { slideUrls } : {}),
    ...(slideUrlsInstagram ? { slideUrlsInstagram } : {}),
    ...(imagePostUrl ? { imagePostUrl } : {}),
    ...(reelMp4Url ? { reelMp4Url } : {}),
  };
}

/**
 * Bunny URLs from a Hub schedule `payload`. Upserts store flat fields
 * (`reelMp4Url`, `slideUrls`, …); older rows may use nested `bunnyUrls`.
 */
export function bunnyUrlsFromHubSchedulePayload(
  payload: Record<string, unknown> | Partial<HubSchedulePayload> | null | undefined,
): BunnyAssetUrls | undefined {
  const p = (payload ?? {}) as Record<string, unknown>;
  const flat = bunnyUrlsFromFlatFields(p);
  const nestedRaw = p.bunnyUrls;
  const nested =
    nestedRaw && typeof nestedRaw === "object" && !Array.isArray(nestedRaw)
      ? bunnyUrlsFromFlatFields(nestedRaw as Record<string, unknown>)
      : undefined;
  if (!flat && !nested) return undefined;
  return { ...nested, ...flat };
}

/**
 * Hub `scheduleKind` only has three values: "post" | "reel" | "short".
 * Multiplier's `ScheduleContentKind` is "carousel" | "photo" | "short".
 * We collapse carousel + photo → "post" for Hub storage, then restore the
 * finer-grained kind from `payload.uiScheduleKind` on read.
 */
export function hubKindFor(
  uiKind: ScheduleContentKind | undefined,
): "post" | "reel" | "short" {
  if (uiKind === "short") return "short";
  // carousel + photo + undefined (legacy carousel default) → "post"
  return "post";
}

/** Build the POST /api/v1/schedule (upsert) body from a Multiplier row. */
export function postToHubBody(
  row: ScheduledCarouselPost,
): {
  id: string;
  scheduleKind: "post" | "reel" | "short";
  publishAt: string;
  payload: HubSchedulePayload;
} {
  const payload: HubSchedulePayload = {
    v: 1,
    queueItemId: row.queueItemId,
    videoLabel: row.videoLabel,
    caption: row.caption,
    postToInstagram: row.postToInstagram,
    postToFacebook: row.postToFacebook,
    uiScheduleKind: row.scheduleKind ?? "carousel",
    ...(row.postToYouTube != null ? { postToYouTube: row.postToYouTube } : {}),
    ...(row.slideCount != null ? { slideCount: row.slideCount } : {}),
    ...(row.calendarThumbJpegs && row.calendarThumbJpegs.length > 0
      ? { calendarThumbJpegs: row.calendarThumbJpegs }
      : {}),
    ...(row.displayHook ? { displayHook: row.displayHook } : {}),
    ...(row.bunnyUrls?.slideUrls && row.bunnyUrls.slideUrls.length > 0
      ? { slideUrls: row.bunnyUrls.slideUrls }
      : {}),
    ...(row.bunnyUrls?.slideUrlsInstagram &&
    row.bunnyUrls.slideUrlsInstagram.length > 0
      ? { slideUrlsInstagram: row.bunnyUrls.slideUrlsInstagram }
      : {}),
    ...(row.bunnyUrls?.imagePostUrl
      ? { imagePostUrl: row.bunnyUrls.imagePostUrl }
      : {}),
    ...(row.bunnyUrls?.reelMp4Url
      ? { reelMp4Url: row.bunnyUrls.reelMp4Url }
      : {}),
    ...(() => {
      const fc = coerceFirstCommentField(row.firstComment);
      return fc ? { firstComment: fc } : {};
    })(),
  };
  return {
    id: row.id,
    scheduleKind: hubKindFor(row.scheduleKind),
    publishAt: new Date(row.publishAtUnix * 1000).toISOString(),
    payload,
  };
}

/** Convert a Hub row back to the Multiplier's ScheduledCarouselPost shape. */
export function hubToScheduledPost(
  entry: HubScheduleEntry,
): ScheduledCarouselPost {
  const p = entry.payload ?? ({ v: 1 } as Partial<HubSchedulePayload>);
  const bunnyUrls = bunnyUrlsFromHubSchedulePayload(
    p as Record<string, unknown>,
  );
  return {
    id: entry.id,
    queueItemId: typeof p.queueItemId === "string" ? p.queueItemId : entry.id,
    videoLabel: typeof p.videoLabel === "string" ? p.videoLabel : "",
    publishAtUnix: Math.floor(new Date(entry.publishAt).getTime() / 1000),
    caption: typeof p.caption === "string" ? p.caption : "",
    postToInstagram: p.postToInstagram === true,
    postToFacebook: p.postToFacebook === true,
    createdAt: new Date(entry.createdAt).getTime(),
    ...(p.postToYouTube != null ? { postToYouTube: p.postToYouTube === true } : {}),
    ...(typeof p.slideCount === "number" ? { slideCount: p.slideCount } : {}),
    ...(p.calendarThumbJpegs && Array.isArray(p.calendarThumbJpegs)
      ? { calendarThumbJpegs: p.calendarThumbJpegs }
      : {}),
    ...(p.uiScheduleKind
      ? { scheduleKind: p.uiScheduleKind }
      : entry.scheduleKind === "short"
        ? { scheduleKind: "short" as const }
        : { scheduleKind: "carousel" as const }),
    ...(typeof p.displayHook === "string"
      ? { displayHook: p.displayHook }
      : {}),
    ...(bunnyUrls ? { bunnyUrls } : {}),
    ...(() => {
      const fc = coerceFirstCommentField(
        typeof p.firstComment === "string" ? p.firstComment : undefined
      );
      return fc ? { firstComment: fc } : {};
    })(),
  };
}
