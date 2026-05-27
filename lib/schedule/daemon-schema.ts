import type { ScheduledCarouselPost } from "@/context/schedule-context";

/**
 * Persisted row for the macOS launchd daemon: same metadata as the calendar plus
 * slide PNGs for Meta (carousel / photo) or a stored reel MP4 on disk for Short.
 *
 * Phase 2.0: `bunnyUrls` (inherited from ScheduledCarouselPost) takes priority
 * over `publishSlidesBase64`. Publish-now / publish-due fetch from the URLs
 * server-side and skip the legacy base64 disk read when both are present.
 */
export type DaemonScheduleEntry = ScheduledCarouselPost & {
  /** Raw base64 or data-URL PNGs for `postMetaCarouselPublish` (carousel or photo). */
  publishSlidesBase64?: string[];
  /**
   * When `scheduleKind === "short"`, reel MP4 is saved at `.data/daemon-reels/{id}.mp4`
   * via POST `/api/schedule/daemon-upsert-reel`.
   */
  reelVideoStored?: boolean;
  /** Set after a successful daemon publish (unix seconds). */
  daemonPublishedAt?: number;
  /** Last error message from daemon publish attempt. */
  daemonLastError?: string;
};

export function isDaemonCarouselOrPhotoPublishable(
  e: DaemonScheduleEntry,
): boolean {
  if (e.scheduleKind === "short") return false;
  const allowedKind =
    e.scheduleKind === "carousel" ||
    e.scheduleKind === "photo" ||
    !e.scheduleKind;
  if (!allowedKind) return false;
  // Phase 2.0: prefer Bunny URLs when present; fall back to legacy base64.
  const hasBunnyUrls =
    (e.bunnyUrls?.slideUrls && e.bunnyUrls.slideUrls.length > 0) ||
    !!e.bunnyUrls?.imagePostUrl;
  const hasBase64 =
    Array.isArray(e.publishSlidesBase64) && e.publishSlidesBase64.length > 0;
  return hasBunnyUrls || hasBase64;
}

export function isDaemonReelPublishable(e: DaemonScheduleEntry): boolean {
  return e.scheduleKind === "short" && e.reelVideoStored === true;
}

/** @deprecated use isDaemonCarouselOrPhotoPublishable or isDaemonReelPublishable */
export function isDaemonPublishableEntry(
  e: DaemonScheduleEntry
): e is DaemonScheduleEntry & { publishSlidesBase64: string[] } {
  return isDaemonCarouselOrPhotoPublishable(e);
}
