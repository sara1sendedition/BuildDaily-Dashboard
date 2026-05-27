"use client";

import {
  ExternalCalendarVideosPanel,
  ExternalVideoPickRow,
} from "@/app/components/schedule/ExternalCalendarVideosPanel";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  useCarouselWorkspace,
  type QueueCarouselSnapshot,
  type VideoQueueItem,
} from "@/context/carousel-workspace-context";
import { useScheduleStore, type ScheduledCarouselPost } from "@/context/schedule-context";
import {
  type ScheduleContentKind,
  displayHookForSchedule,
  scheduleTitleForQueueItem,
  defaultScheduleKindForQueue,
  queueHasSchedulableOutput,
  downscalePngBase64ToJpegDataUrl,
  photoAssetReadyForSchedule,
  pickPhotoPreviewPngsForCalendar,
  pickSlidePreviewPngsForCalendar,
  slideCountForCalendar,
} from "@/lib/schedule/calendar-preview-thumbs";
import {
  queueItemDisplayLabel,
  queueItemScheduleLabel,
} from "@/lib/queue-display-label";
import {
  postMetaCarouselPublish,
  postMetaReelPublish,
} from "@/lib/meta/publish-meta-client";
import type { DaemonScheduleEntry } from "@/lib/schedule/daemon-schema";
import {
  fetchDaemonStatuses,
  publishNowViaDaemon,
  type DaemonPublishRowStatus,
} from "@/lib/schedule/daemon-client";
import {
  bunnySlideUrlsForMetaPublish,
  captionFromImagePostSnapshot,
  captionFromSnapshot,
  imagePostSlideForMeta,
  slidesForMetaFromZipOrSnapshot,
} from "@/lib/schedule/slides-for-meta-from-snapshot";
import { clientApiPath } from "@/lib/client-api-path";
import {
  coerceFirstCommentField,
  getDefaultFirstCommentFromStorage,
  MAX_DEFAULT_FIRST_COMMENT_CHARS,
} from "@/lib/default-first-comment";
import {
  displayHookFromExternalVideo,
  externalVideoLabel,
  filterExternalCalendarVideos,
  parseScheduleDragPayload,
  uploadExternalCalendarReel,
  type ExternalCalendarVideo,
} from "@/lib/schedule/external-calendar-video";
import { postYoutubeShortPublish } from "@/lib/youtube/publish-youtube-client";

const DRAG_MIME = "application/x-video-studio-queue-id";

function applyModalKindDefaults(
  kind: ScheduleContentKind,
  snap: QueueCarouselSnapshot | null,
  setModalCaption: (v: string) => void,
  setPostIg: (v: boolean) => void,
  setPostFb: (v: boolean) => void,
  setPostYt: (v: boolean) => void,
  youtubeReady: boolean
): void {
  if (kind === "photo" && snap) {
    setModalCaption(captionFromImagePostSnapshot(snap));
  } else if (kind === "short" && snap) {
    const c = snap.socialCaption?.trim();
    setModalCaption(
      c && c.length > 0
        ? c
        : captionFromImagePostSnapshot(snap) || captionFromSnapshot(snap)
    );
  } else {
    setModalCaption(snap ? captionFromSnapshot(snap) : "");
  }
  if (kind === "carousel" && snap) {
    const anySlides =
      pickSlidePreviewPngsForCalendar(snap, true, true).length > 0;
    setPostIg(anySlides);
    setPostFb(anySlides);
  } else {
    setPostIg(true);
    setPostFb(true);
  }
  setPostYt(kind === "short" && youtubeReady);
}

type ReadyToScheduleRowProps = {
  q: VideoQueueItem;
  snap: QueueCarouselSnapshot | null;
  mode: "drag" | "pick";
  onPick?: () => void;
  /** Flushes the active editor row before drag/pick checks. */
  resolveSnapshot?: (queueItemId: string) => QueueCarouselSnapshot | null;
};

function ReadyToScheduleVideoRow({
  q,
  snap,
  mode,
  onPick,
  resolveSnapshot,
}: ReadyToScheduleRowProps) {
  const carThumb = snap?.firstSlidePreviewBase64 ?? null;
  const phB64 = snap?.imagePost?.imageBase64;
  const photoReady = typeof phB64 === "string" && phB64.length > 0;
  const carouselReady =
    Boolean(snap?.zipBase64) &&
    pickSlidePreviewPngsForCalendar(snap, true, true).length > 0;
  const shortReady = Boolean(q.shortOutputFile);
  const canSchedule = queueHasSchedulableOutput(snap, q);
  const title = queueItemDisplayLabel(q);
  const outputHints = [
    carouselReady && "Carousel",
    photoReady && "Photo",
    shortReady && "Short",
  ].filter(Boolean) as string[];

  const thumb = carThumb ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/png;base64,${carThumb}`}
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 object-cover"
    />
  ) : photoReady ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/png;base64,${phB64}`}
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 object-cover"
    />
  ) : shortReady ? (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[10px] font-semibold text-white">
      ▶
    </div>
  ) : (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-xs text-stone-500">
      …
    </div>
  );

  const body = (
    <>
      {thumb}
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-stone-800">{title}</p>
        {outputHints.length > 0 ? (
          <p className="mt-0.5 text-[10px] text-stone-500">
            {outputHints.join(" · ")}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] text-stone-500">
            Open on Multiplier to generate outputs
          </p>
        )}
      </div>
    </>
  );

  const freshSnap = () => resolveSnapshot?.(q.id) ?? snap;

  if (mode === "pick") {
    return (
      <button
        type="button"
        onClick={() => {
          if (!queueHasSchedulableOutput(freshSnap(), q)) return;
          onPick?.();
        }}
        className={`flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/80 p-2 text-left transition ${
          canSchedule
            ? "hover:border-palette-teal/40 hover:bg-palette-pale/20"
            : "cursor-not-allowed opacity-60"
        }`}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      draggable={canSchedule}
      onDragStart={(e) => {
        if (!queueHasSchedulableOutput(freshSnap(), q)) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(
          DRAG_MIME,
          JSON.stringify({ queueItemId: q.id })
        );
        e.dataTransfer.setData("text/plain", queueItemScheduleLabel(q));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/80 p-2 ${
        canSchedule
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-not-allowed opacity-60"
      }`}
    >
      {body}
    </div>
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function localDateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `datetime-local` value in the user's local timezone. */
function toDatetimeLocalValue(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function isScheduleDaemonPublished(
  it: ScheduledCarouselPost,
  byId: Map<string, DaemonPublishRowStatus> | undefined
): boolean {
  const row = byId?.get(it.id);
  return row != null && row.daemonPublishedAt != null && row.daemonPublishedAt > 0;
}

function calendarCells(viewMonth: Date): ({ kind: "empty" } | { kind: "day"; day: number })[] {
  const first = startOfMonth(viewMonth);
  const pad = first.getDay();
  const dim = daysInMonth(viewMonth);
  const cells: ({ kind: "empty" } | { kind: "day"; day: number })[] = [];
  for (let i = 0; i < pad; i++) cells.push({ kind: "empty" });
  for (let day = 1; day <= dim; day++) cells.push({ kind: "day", day });
  return cells;
}

function combineLocalDateAndTime(year: number, monthIndex: number, day: number, timeHHMM: string): Date {
  const [h, m] = timeHHMM.split(":").map((x) => parseInt(x, 10));
  const d = new Date(year, monthIndex, day);
  d.setHours(Number.isFinite(h) ? h : 10, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function scheduleItemKind(it: ScheduledCarouselPost): ScheduleContentKind {
  const k = it.scheduleKind;
  if (k === "photo" || k === "short") return k;
  return "carousel";
}

function schedulePrimaryTitle(it: ScheduledCarouselPost): string {
  const hook =
    it.displayHook?.trim() ||
    it.videoLabel.replace(/\.[^/.]+$/, "").trim() ||
    it.videoLabel;
  return hook;
}

function scheduleKindPillCalendar(kind: ScheduleContentKind): {
  label: string;
  className: string;
} {
  if (kind === "photo") {
    return {
      label: "Photo",
      className:
        "shrink-0 rounded bg-sky-200/90 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-sky-950",
    };
  }
  if (kind === "short") {
    return {
      label: "Short",
      className:
        "shrink-0 rounded bg-violet-200/90 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-violet-950",
    };
  }
  return {
    label: "Carousel",
    className:
      "shrink-0 rounded bg-palette-moss/35 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-palette-depth",
  };
}

function scheduleKindPillRow(kind: ScheduleContentKind): {
  label: string;
  className: string;
} {
  if (kind === "photo") {
    return {
      label: "Photo",
      className:
        "shrink-0 rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900",
    };
  }
  if (kind === "short") {
    return {
      label: "Short",
      className:
        "shrink-0 rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-900",
    };
  }
  return {
    label: "Carousel",
    className:
      "shrink-0 rounded-md bg-palette-moss/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-palette-depth",
  };
}

function scheduleKindPillModal(kind: ScheduleContentKind): {
  label: string;
  className: string;
} {
  if (kind === "photo") {
    return {
      label: "Photo",
      className:
        " ml-2 rounded-md bg-sky-100 px-2 py-0.5 text-xs font-bold uppercase text-sky-900",
    };
  }
  if (kind === "short") {
    return {
      label: "Short",
      className:
        " ml-2 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-bold uppercase text-violet-900",
    };
  }
  return {
    label: "Carousel",
    className:
      " ml-2 rounded-md bg-palette-moss/25 px-2 py-0.5 text-xs font-bold uppercase text-palette-depth",
  };
}

function isDaemonPublishUiEnabled(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET?.trim()
  );
}

type DaemonPublishBadge = { label: string; className: string; title?: string };

function daemonPublishBadge(
  it: ScheduledCarouselPost,
  byId: Map<string, DaemonPublishRowStatus> | undefined,
  nowSec: number,
  variant: "cell" | "row"
): DaemonPublishBadge | null {
  if (!isDaemonPublishUiEnabled()) return null;
  if (byId === undefined) return null;
  const size =
    variant === "cell"
      ? "text-[8px] px-1 py-px"
      : "text-[10px] px-2 py-0.5";
  const row = byId?.get(it.id);
  if (!row) {
    return {
      label: "Not synced",
      className: `shrink-0 rounded font-semibold uppercase tracking-wide bg-amber-200/90 text-amber-950 ${size}`,
      title:
        "Not on the server publish list. Schedule again from this browser or check the console for [daemon-upsert] errors.",
    };
  }
  if (row.daemonPublishedAt != null && row.daemonPublishedAt > 0) {
    const t = new Date(row.daemonPublishedAt * 1000).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    return {
      label: "Published",
      className: `shrink-0 rounded font-semibold uppercase tracking-wide bg-emerald-200/90 text-emerald-950 ${size}`,
      title: `Auto-published ${t}`,
    };
  }
  if (row.daemonLastError && row.daemonLastError.trim().length > 0) {
    return {
      label: "Error",
      className: `shrink-0 rounded font-semibold uppercase tracking-wide bg-red-200/90 text-red-950 ${size}`,
      title: row.daemonLastError,
    };
  }
  if (it.publishAtUnix <= nowSec) {
    return {
      label: "Pending",
      className: `shrink-0 rounded font-semibold uppercase tracking-wide bg-amber-100 text-amber-900 ${size}`,
      title:
        "Due time passed. The launchd job (about every 5 minutes) should publish soon if the studio server is running.",
    };
  }
  return {
    label: "Auto",
    className: `shrink-0 rounded font-semibold uppercase tracking-wide bg-stone-200/80 text-stone-600 ${size}`,
    title:
      "Will auto-publish when the time is due if the server and Mac publish job are running.",
  };
}

function DaemonPublishStatusSpan({
  entry,
  byId,
  variant,
}: {
  entry: ScheduledCarouselPost;
  byId: Map<string, DaemonPublishRowStatus> | undefined;
  variant: "cell" | "row";
}) {
  const badge = daemonPublishBadge(
    entry,
    byId,
    Math.floor(Date.now() / 1000),
    variant
  );
  if (!badge) return null;
  return (
    <span
      className={badge.className}
      title={badge.title}
      aria-label={badge.title ?? badge.label}
    >
      {badge.label}
    </span>
  );
}

type PublishEntryResult =
  | {
      ok: true;
      instagramMediaId?: string;
      facebookPostId?: string;
      youtubeVideoId?: string;
      firstCommentErrors?: string[];
      firstCommentDeferred?: boolean;
      /** Client upload path used; Bunny assets required for server first-comment. */
      firstCommentSkipped?: boolean;
    }
  | { ok: false; message: string };

function entryHasBunnyAssetsForPublish(
  entry: ScheduledCarouselPost,
  kind: ScheduleContentKind
): boolean {
  const u = entry.bunnyUrls;
  if (kind === "short") return !!u?.reelMp4Url?.trim();
  if (kind === "photo") return !!u?.imagePostUrl?.trim();
  const slides = bunnySlideUrlsForMetaPublish(
    u,
    entry.postToInstagram,
    entry.postToFacebook,
    "carousel",
  );
  return (slides?.length ?? 0) > 0;
}

function mapDaemonPublishResult(
  r: Awaited<ReturnType<typeof publishNowViaDaemon>>
): PublishEntryResult {
  if (!r.ok) return { ok: false, message: r.message };
  return {
    ok: true,
    instagramMediaId: r.instagramMediaId,
    facebookPostId: r.facebookPostId,
    youtubeVideoId: r.youtubeVideoId,
    ...(r.firstCommentErrors?.length
      ? { firstCommentErrors: r.firstCommentErrors }
      : {}),
    ...(r.firstCommentDeferred ? { firstCommentDeferred: true } : {}),
  };
}

function firstCommentPublishNote(r: Extract<PublishEntryResult, { ok: true }>): string | null {
  if (r.firstCommentDeferred) {
    return "First comment was not posted yet (post is scheduled on Meta — it will not appear until the post is live).";
  }
  if (r.firstCommentErrors?.length) {
    return `Published, but first comment failed: ${r.firstCommentErrors.join(" ")}`;
  }
  if (r.firstCommentSkipped) {
    return "Published, but first comment was not sent. Open the video on the home page so assets upload to Bunny, then publish again or wait for the scheduled time.";
  }
  return null;
}

/**
 * Manual "Send to Meta" for one calendar row. Carousel/photo slides and short reels
 * live only in browser memory (home-page workspace), so when the user has removed
 * the video from the queue or reloaded since scheduling, the in-memory snapshot is
 * gone. In that case we fall back to the server's persisted slides / reel via
 * `publishNowViaDaemon`, which reads from `.data/daemon-schedule.json` and
 * `.data/daemon-reels/{id}.mp4` — the same data the launchd daemon already uses.
 */
async function runPublishEntryToMeta(
  entry: ScheduledCarouselPost,
  resolveSnapshot: (queueItemId: string) => QueueCarouselSnapshot | null,
  getShortFile: (queueItemId: string) => File | null | undefined
): Promise<PublishEntryResult> {
  const snap = resolveSnapshot(entry.queueItemId);
  const kind = scheduleItemKind(entry);
  const firstCommentText = coerceFirstCommentField(entry.firstComment);
  if (
    firstCommentText &&
    entryHasBunnyAssetsForPublish(entry, kind)
  ) {
    return mapDaemonPublishResult(
      await publishNowViaDaemon(entry.id, {
        scheduledPublishTime: entry.publishAtUnix,
      })
    );
  }
  const firstCommentSkipped =
    !!firstCommentText && !entryHasBunnyAssetsForPublish(entry, kind);
  let slides: string[];
  if (kind === "short") {
    const vid = getShortFile(entry.queueItemId) ?? undefined;
    if (!vid) {
      // No reel file in memory — let the server publish from the stored MP4.
      return mapDaemonPublishResult(
        await publishNowViaDaemon(entry.id, {
          scheduledPublishTime: entry.publishAtUnix,
        })
      );
    }
    const wantsMeta = entry.postToInstagram || entry.postToFacebook;
    const wantsYt = entry.postToYouTube === true;
    if (!wantsMeta && !wantsYt) {
      return {
        ok: false,
        message:
          "Choose Instagram, Facebook, and/or YouTube for this Short.",
      };
    }
    let instagramMediaId: string | undefined;
    let facebookPostId: string | undefined;
    if (wantsMeta) {
      let res: Response;
      try {
        res = await postMetaReelPublish({
          video: vid,
          caption: entry.caption,
          publishInstagram: entry.postToInstagram,
          publishFacebook: entry.postToFacebook,
          scheduledPublishTime: entry.publishAtUnix,
        });
      } catch (e) {
        return {
          ok: false,
          message:
            e instanceof Error ? e.message : "Could not start reel upload.",
        };
      }
      const raw = await res.text();
      let data: {
        error?: string;
        instagramMediaId?: string;
        facebookVideoId?: string;
      };
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        return {
          ok: false,
          message: `Publish failed (${res.status}). Invalid response.`,
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          message: data.error ?? `Publish failed (${res.status}).`,
        };
      }
      instagramMediaId =
        typeof data.instagramMediaId === "string"
          ? data.instagramMediaId
          : undefined;
      facebookPostId =
        typeof data.facebookVideoId === "string"
          ? data.facebookVideoId
          : undefined;
    }
    let youtubeVideoId: string | undefined;
    if (wantsYt) {
      const ytErrors: string[] = [];
      try {
        const ytRes = await postYoutubeShortPublish({
          video: vid,
          caption: entry.caption,
          scheduledPublishTime: entry.publishAtUnix,
        });
        const ytRaw = await ytRes.text();
        let ytData: { error?: string; youtubeVideoId?: string };
        try {
          ytData = ytRaw ? (JSON.parse(ytRaw) as typeof ytData) : {};
        } catch {
          ytErrors.push(
            `YouTube: invalid JSON (${ytRes.status}). Check the server log.`
          );
          ytData = {};
        }
        if (!ytRes.ok) {
          ytErrors.push(ytData.error ?? `YouTube failed (${ytRes.status}).`);
        } else if (typeof ytData.youtubeVideoId === "string") {
          youtubeVideoId = ytData.youtubeVideoId;
        }
      } catch (e) {
        ytErrors.push(
          `YouTube: ${e instanceof Error ? e.message : "Upload request failed."}`
        );
      }
      if (ytErrors.length > 0) {
        return { ok: false, message: ytErrors.join(" · ") };
      }
    }
    return {
      ok: true,
      instagramMediaId,
      facebookPostId,
      youtubeVideoId,
      ...(firstCommentSkipped ? { firstCommentSkipped: true } : {}),
    };
  }
  if (kind === "photo") {
    slides = snap ? imagePostSlideForMeta(snap) : [];
    if (slides.length === 0) {
      // No in-memory JPEG — publish from Bunny URL on the schedule row (Hub).
      return mapDaemonPublishResult(
        await publishNowViaDaemon(entry.id, {
          scheduledPublishTime: entry.publishAtUnix,
        })
      );
    }
  } else {
    if (!snap) {
      // No in-memory snapshot — fall back to server-persisted slides.
      return mapDaemonPublishResult(
        await publishNowViaDaemon(entry.id, {
          scheduledPublishTime: entry.publishAtUnix,
        })
      );
    }
    slides = await slidesForMetaFromZipOrSnapshot(
      snap,
      entry.postToInstagram,
      entry.postToFacebook
    );
    if (slides.length === 0) {
      return {
        ok: false,
        message: "No slide images available for this carousel.",
      };
    }
  }
  let res: Response;
  try {
    res = await postMetaCarouselPublish({
      caption: entry.caption,
      publishInstagram: entry.postToInstagram,
      publishFacebook: entry.postToFacebook,
      scheduledPublishTime: entry.publishAtUnix,
      slidesBase64: slides,
    });
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "Could not start publish upload.",
    };
  }
  const raw = await res.text();
  let data: { error?: string; instagramMediaId?: string; facebookPostId?: string };
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    return {
      ok: false,
      message: `Publish failed (${res.status}). Invalid response.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      message: data.error ?? `Publish failed (${res.status}).`,
    };
  }
  return {
    ok: true,
    instagramMediaId:
      typeof data.instagramMediaId === "string"
        ? data.instagramMediaId
        : undefined,
    facebookPostId:
      typeof data.facebookPostId === "string" ? data.facebookPostId : undefined,
    ...(firstCommentSkipped ? { firstCommentSkipped: true } : {}),
  };
}

/** Thumbnails for a scheduled row: persisted JPEGs or live snapshot fallback. */
function scheduleItemThumbDisplay(
  it: ScheduledCarouselPost,
  getSnapshot: (queueItemId: string) => QueueCarouselSnapshot | null
): { srcs: string[]; moreCount: number } {
  const persisted = it.calendarThumbJpegs;
  if (persisted && persisted.length > 0) {
    const total = it.slideCount ?? persisted.length;
    return { srcs: persisted, moreCount: Math.max(0, total - persisted.length) };
  }
  const snap = getSnapshot(it.queueItemId);
  if (!snap) return { srcs: [], moreCount: it.slideCount ?? 0 };
  if (scheduleItemKind(it) === "short") {
    return { srcs: [], moreCount: 0 };
  }
  if (scheduleItemKind(it) === "photo") {
    const photoPngs = pickPhotoPreviewPngsForCalendar(snap);
    const raw = photoPngs[0];
    if (!raw) return { srcs: [], moreCount: 0 };
    return { srcs: [`data:image/png;base64,${raw}`], moreCount: 0 };
  }
  const pngs = pickSlidePreviewPngsForCalendar(
    snap,
    it.postToInstagram,
    it.postToFacebook
  );
  const totalSlides =
    it.slideCount ?? slideCountForCalendar(snap, pngs);
  if (pngs.length > 0) {
    const cap = Math.min(5, pngs.length);
    const srcs = pngs
      .slice(0, cap)
      .map((b64) => `data:image/png;base64,${b64}`);
    return {
      srcs,
      moreCount: Math.max(0, totalSlides - srcs.length),
    };
  }
  const raw = snap.firstSlidePreviewBase64;
  if (!raw) return { srcs: [], moreCount: totalSlides };
  return {
    srcs: [`data:image/png;base64,${raw}`],
    moreCount: Math.max(0, totalSlides - 1),
  };
}

export default function SchedulePage() {
  const {
    queue,
    queueSnapshots,
    activeQueueId,
    flushActiveQueueSnapshot,
  } = useCarouselWorkspace();
  const {
    items,
    addScheduled,
    moveScheduled: moveScheduledInStore,
    updateScheduled,
    removeScheduled: removeScheduledFromStore,
  } = useScheduleStore();

  const removeScheduled = useCallback(
    async (id: string) => {
      // Phase 4.B: Hub is the sole sync target. removeScheduledFromStore
      // already fires deleteScheduledPostFromHub. The legacy daemon-delete
      // call to `.data/daemon-schedule.json` is no longer needed; publish-due
      // reads from the Hub via /api/v1/internal/schedule/due.
      removeScheduledFromStore(id);
    },
    [removeScheduledFromStore]
  );

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [externalVideos, setExternalVideos] = useState<ExternalCalendarVideo[]>(
    []
  );
  const [scheduleUploadError, setScheduleUploadError] = useState<string | null>(
    null
  );
  const externalUploadInputId = useId();
  const [pendingDrop, setPendingDrop] = useState<{
    queueItemId?: string;
    externalVideoId?: string;
    videoLabel: string;
    year: number;
    monthIndex: number;
    day: number;
  } | null>(null);
  const [timeStr, setTimeStr] = useState("09:00");
  const [modalCaption, setModalCaption] = useState("");
  const [modalFirstComment, setModalFirstComment] = useState("");
  const [postIg, setPostIg] = useState(true);
  const [postFb, setPostFb] = useState(true);
  const [postYt, setPostYt] = useState(false);
  const [youtubeConfigured, setYoutubeConfigured] = useState<boolean | null>(
    null
  );
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const publishLocked = publishBusyId !== null;
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [modalScheduleKind, setModalScheduleKind] =
    useState<ScheduleContentKind>("carousel");
  const [moveEntry, setMoveEntry] = useState<ScheduledCarouselPost | null>(null);
  const [moveTimeLocal, setMoveTimeLocal] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);
  const [dayPickTarget, setDayPickTarget] = useState<{
    year: number;
    monthIndex: number;
    day: number;
  } | null>(null);
  const [detailEntry, setDetailEntry] = useState<ScheduledCarouselPost | null>(
    null
  );
  const [detailCaption, setDetailCaption] = useState("");
  const [detailFirstComment, setDetailFirstComment] = useState("");
  const [detailPostIg, setDetailPostIg] = useState(true);
  const [detailPostFb, setDetailPostFb] = useState(true);
  const [detailPostYt, setDetailPostYt] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);

  /** `undefined` = loading or daemon secret unset; else server snapshot by schedule id. */
  const [daemonStatusById, setDaemonStatusById] = useState<
    Map<string, DaemonPublishRowStatus> | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          clientApiPath("/api/integrations/youtube/status")
        );
        const j = (await res.json()) as { configured?: boolean };
        if (!cancelled) setYoutubeConfigured(!!j.configured);
      } catch {
        if (!cancelled) setYoutubeConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDaemonPublishUiEnabled()) {
      setDaemonStatusById(undefined);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const rows = await fetchDaemonStatuses();
      if (cancelled) return;
      if (rows !== null) {
        setDaemonStatusById(new Map(rows.map((r) => [r.id, r])));
      }
    };
    void load();
    const t = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [items]);

  const doneQueue = useMemo(
    () => queue.filter((q) => q.status === "done"),
    [queue]
  );

  const hasSchedulableDoneQueue = useMemo(
    () =>
      externalVideos.length > 0 ||
      doneQueue.some((q) =>
        queueHasSchedulableOutput(queueSnapshots[q.id] ?? null, q)
      ),
    [doneQueue, externalVideos.length, queueSnapshots]
  );

  const addExternalVideos = useCallback((files: File[]) => {
    const next = filterExternalCalendarVideos(files);
    if (next.length === 0) return;
    setScheduleUploadError(null);
    setExternalVideos((prev) => [...prev, ...next]);
  }, []);

  const removeExternalVideo = useCallback((id: string) => {
    setExternalVideos((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const findExternalVideo = useCallback(
    (id: string | undefined) =>
      id ? (externalVideos.find((v) => v.id === id) ?? null) : null,
    [externalVideos]
  );

  useEffect(() => {
    if (!activeQueueId) return;
    if (!doneQueue.some((q) => q.id === activeQueueId)) return;
    flushActiveQueueSnapshot();
  }, [activeQueueId, doneQueue, flushActiveQueueSnapshot]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ScheduledCarouselPost[]>();
    for (const it of items) {
      const d = new Date(it.publishAtUnix * 1000);
      const key = localDateKey(d.getFullYear(), d.getMonth(), d.getDate());
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.publishAtUnix - b.publishAtUnix);
    }
    return map;
  }, [items]);

  /** Read-only: safe during render (no state updates). */
  const peekQueueSnapshot = useCallback(
    (queueItemId: string) => queueSnapshots[queueItemId] ?? null,
    [queueSnapshots]
  );

  /**
   * When `queueItemId` is the active home editor, persist workspace to `queueSnapshots` then return it.
   * Otherwise read from `queueSnapshots` only. Call from events/async — not during render (use peek).
   */
  const resolveSnapshot = useCallback(
    (queueItemId: string) => {
      if (queueItemId === activeQueueId) {
        const flushed = flushActiveQueueSnapshot();
        if (flushed) return flushed;
      }
      return queueSnapshots[queueItemId] ?? null;
    },
    [activeQueueId, flushActiveQueueSnapshot, queueSnapshots]
  );

  const openTimeModal = useCallback(
    (
      args: {
        videoLabel: string;
        year: number;
        monthIndex: number;
        day: number;
        scheduleKind?: ScheduleContentKind;
      } & (
        | { queueItemId: string; externalVideoId?: undefined }
        | {
            externalVideoId: string;
            /** Pass when the video was just added — state may not have flushed yet. */
            externalVideo?: ExternalCalendarVideo;
            queueItemId?: undefined;
          }
      )
    ) => {
      const { videoLabel, year, monthIndex, day, scheduleKind } = args;
      if (args.externalVideoId) {
        const ext =
          findExternalVideo(args.externalVideoId) ?? args.externalVideo;
        if (!ext) return;
        if (!findExternalVideo(args.externalVideoId)) {
          setExternalVideos((prev) =>
            prev.some((v) => v.id === ext.id) ? prev : [...prev, ext]
          );
        }
        setModalScheduleKind("short");
        setTimeStr("09:00");
        setModalFirstComment(getDefaultFirstCommentFromStorage().trim());
        setModalCaption(displayHookFromExternalVideo(ext.file));
        setPostIg(true);
        setPostFb(true);
        setPostYt(youtubeConfigured === true);
        setDetailEntry(null);
        setScheduleUploadError(null);
        setPendingDrop({
          externalVideoId: args.externalVideoId,
          videoLabel,
          year,
          monthIndex,
          day,
        });
        return;
      }
      const queueItemId = args.queueItemId;
      if (!queueItemId) return;
      const snap = resolveSnapshot(queueItemId);
      const queueRow = queue.find((q) => q.id === queueItemId);
      const kind =
        scheduleKind ??
        defaultScheduleKindForQueue(snap, queueRow ?? { shortOutputFile: null });
      setModalScheduleKind(kind);
      setTimeStr("09:00");
      setModalFirstComment(getDefaultFirstCommentFromStorage().trim());
      applyModalKindDefaults(
        kind,
        snap,
        setModalCaption,
        setPostIg,
        setPostFb,
        setPostYt,
        youtubeConfigured === true
      );
      setDetailEntry(null);
      setScheduleUploadError(null);
      setPendingDrop({ queueItemId, videoLabel, year, monthIndex, day });
    },
    [findExternalVideo, resolveSnapshot, queue, youtubeConfigured]
  );

  const openDetailModal = useCallback((entry: ScheduledCarouselPost) => {
    setPendingDrop(null);
    setDayPickTarget(null);
    setMoveEntry(null);
    setDetailEntry(entry);
    setDetailCaption(entry.caption);
    setDetailFirstComment(entry.firstComment ?? "");
    setDetailPostIg(entry.postToInstagram);
    setDetailPostFb(entry.postToFacebook);
    setDetailPostYt(entry.postToYouTube === true);
  }, []);

  const confirmDetailUpdate = useCallback(() => {
    if (!detailEntry || detailSaving) return;
    if (isScheduleDaemonPublished(detailEntry, daemonStatusById)) return;
    const kind = scheduleItemKind(detailEntry);
    const hasDestination =
      detailPostIg ||
      detailPostFb ||
      (kind === "short" && detailPostYt && youtubeConfigured === true);
    if (!hasDestination) return;
    setDetailSaving(true);
    try {
      updateScheduled(detailEntry.id, {
        caption: detailCaption.trim(),
        postToInstagram: detailPostIg,
        postToFacebook: detailPostFb,
        ...(kind === "short" ? { postToYouTube: detailPostYt } : {}),
        ...(coerceFirstCommentField(detailFirstComment)
          ? { firstComment: coerceFirstCommentField(detailFirstComment) }
          : { firstComment: undefined }),
      });
      setDetailEntry(null);
    } finally {
      setDetailSaving(false);
    }
  }, [
    detailCaption,
    detailEntry,
    detailFirstComment,
    detailPostFb,
    detailPostIg,
    detailPostYt,
    detailSaving,
    daemonStatusById,
    updateScheduled,
    youtubeConfigured,
  ]);

  const pickVideoForDay = useCallback(
    (q: VideoQueueItem) => {
      if (!dayPickTarget) return;
      const snap = resolveSnapshot(q.id);
      if (!queueHasSchedulableOutput(snap, q)) return;
      const { year, monthIndex, day } = dayPickTarget;
      setDayPickTarget(null);
      openTimeModal({
        queueItemId: q.id,
        videoLabel: queueItemScheduleLabel(q),
        year,
        monthIndex,
        day,
      });
    },
    [dayPickTarget, openTimeModal, resolveSnapshot]
  );

  const pickExternalVideoForDay = useCallback(
    (video: ExternalCalendarVideo) => {
      if (!dayPickTarget) return;
      const { year, monthIndex, day } = dayPickTarget;
      setDayPickTarget(null);
      openTimeModal({
        externalVideoId: video.id,
        videoLabel: externalVideoLabel(video.file),
        year,
        monthIndex,
        day,
      });
    },
    [dayPickTarget, openTimeModal]
  );

  const dayPickDateLabel = dayPickTarget
    ? new Date(
        dayPickTarget.year,
        dayPickTarget.monthIndex,
        dayPickTarget.day
      ).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  useEffect(() => {
    if (!pendingDrop || modalScheduleKind !== "short") return;
    if (youtubeConfigured === true) setPostYt(true);
    else if (youtubeConfigured === false) setPostYt(false);
  }, [pendingDrop, modalScheduleKind, youtubeConfigured]);

  const confirmSchedule = useCallback(async () => {
    if (!pendingDrop) return;
    setScheduleUploadError(null);

    if (pendingDrop.externalVideoId) {
      const ext = findExternalVideo(pendingDrop.externalVideoId);
      if (!ext) return;
      const hasDestination =
        postIg ||
        postFb ||
        (postYt && youtubeConfigured === true);
      if (!hasDestination) return;

      setScheduleSaving(true);
      try {
        const when = combineLocalDateAndTime(
          pendingDrop.year,
          pendingDrop.monthIndex,
          pendingDrop.day,
          timeStr
        );
        const upload = await uploadExternalCalendarReel(ext);
        if ("error" in upload) {
          setScheduleUploadError(upload.error);
          return;
        }
        setExternalVideos((prev) =>
          prev.map((v) =>
            v.id === ext.id ? { ...v, bunnyReelUrl: upload.bunnyReelUrl } : v
          )
        );
        const displayHook = displayHookFromExternalVideo(ext.file);
        addScheduled({
          queueItemId: ext.id,
          videoLabel: externalVideoLabel(ext.file),
          publishAtUnix: Math.floor(when.getTime() / 1000),
          caption: modalCaption.trim(),
          postToInstagram: postIg,
          postToFacebook: postFb,
          postToYouTube: postYt,
          slideCount: 1,
          calendarThumbJpegs: undefined,
          scheduleKind: "short",
          displayHook,
          bunnyUrls: { reelMp4Url: upload.bunnyReelUrl },
          ...(coerceFirstCommentField(modalFirstComment)
            ? { firstComment: coerceFirstCommentField(modalFirstComment) }
            : {}),
        });
        setExternalVideos((prev) => prev.filter((v) => v.id !== ext.id));
        setPendingDrop(null);
      } finally {
        setScheduleSaving(false);
      }
      return;
    }

    const queueItemId = pendingDrop.queueItemId;
    if (!queueItemId) return;
    const snapPreflight = resolveSnapshot(queueItemId);
    if (modalScheduleKind === "photo") {
      if (!photoAssetReadyForSchedule(snapPreflight)) return;
    } else if (modalScheduleKind === "short") {
      const qi = queue.find((q) => q.id === queueItemId);
      if (!qi?.shortOutputFile) return;
    } else if (
      !snapPreflight?.zipBase64 ||
      pickSlidePreviewPngsForCalendar(snapPreflight, postIg, postFb).length === 0
    ) {
      return;
    }
    setScheduleSaving(true);
    try {
      const when = combineLocalDateAndTime(
        pendingDrop.year,
        pendingDrop.monthIndex,
        pendingDrop.day,
        timeStr
      );
      const snap = resolveSnapshot(queueItemId);
      if (!snap) {
        if (modalScheduleKind !== "short") {
          return;
        }
        const shortQueueRow = queue.find((q) => q.id === queueItemId);
        const shortDisplayHook = shortQueueRow?.displayLabel?.trim()
          ? shortQueueRow.displayLabel.trim()
          : displayHookForSchedule(
              "short",
              null,
              pendingDrop.videoLabel
            );
        const bunnyFromQueue = queueSnapshots[queueItemId]?.bunnyUrls;
        addScheduled({
          queueItemId,
          videoLabel: pendingDrop.videoLabel,
          publishAtUnix: Math.floor(when.getTime() / 1000),
          caption: modalCaption.trim(),
          postToInstagram: postIg,
          postToFacebook: postFb,
          postToYouTube: postYt,
          slideCount: 1,
          calendarThumbJpegs: undefined,
          scheduleKind: "short",
          displayHook: shortDisplayHook,
          ...(bunnyFromQueue ? { bunnyUrls: bunnyFromQueue } : {}),
          ...(coerceFirstCommentField(modalFirstComment)
            ? { firstComment: coerceFirstCommentField(modalFirstComment) }
            : {}),
        });
        // Phase 4.B: Hub is the sole sync target (via addScheduled above,
        // which already fires upsertScheduledPostToHub including bunnyUrls).
        // The legacy daemon-upsert-reel call to .data/daemon-reels/ is no
        // longer needed — publish-due reads reelMp4Url from the Hub payload.
        setPendingDrop(null);
        return;
      }
      const previewPngs =
        modalScheduleKind === "photo"
          ? pickPhotoPreviewPngsForCalendar(snap)
          : modalScheduleKind === "short"
            ? []
            : pickSlidePreviewPngsForCalendar(snap, postIg, postFb);
      const slideCount =
        modalScheduleKind === "photo"
          ? previewPngs.length > 0
            ? 1
            : 0
          : modalScheduleKind === "short"
            ? 1
            : slideCountForCalendar(snap, previewPngs);
      let calendarThumbJpegs: string[] | undefined;
      if (previewPngs.length > 0 && modalScheduleKind !== "short") {
        try {
          const cap = modalScheduleKind === "photo" ? 1 : Math.min(5, previewPngs.length);
          calendarThumbJpegs = await Promise.all(
            previewPngs
              .slice(0, cap)
              .map((b64) => downscalePngBase64ToJpegDataUrl(b64, 72, 0.78))
          );
        } catch {
          calendarThumbJpegs = undefined;
        }
      }
      const queueRow = queue.find((q) => q.id === queueItemId);
      const displayHook = queueRow?.displayLabel?.trim()
        ? queueRow.displayLabel.trim()
        : displayHookForSchedule(
            modalScheduleKind,
            snap,
            pendingDrop.videoLabel
          );
      addScheduled({
        queueItemId,
        videoLabel: pendingDrop.videoLabel,
        publishAtUnix: Math.floor(when.getTime() / 1000),
        caption: modalCaption.trim(),
        postToInstagram: postIg,
        postToFacebook: postFb,
        postToYouTube: modalScheduleKind === "short" ? postYt : undefined,
        slideCount: slideCount > 0 ? slideCount : undefined,
        calendarThumbJpegs,
        scheduleKind: modalScheduleKind,
        displayHook,
        // Phase 2.0: persist Bunny URLs (when present) onto the schedule row
        // so the Hub `payload` + daemon-upsert both carry them and the
        // publish path can skip Page-staging.
        ...(snap.bunnyUrls ? { bunnyUrls: snap.bunnyUrls } : {}),
        ...(coerceFirstCommentField(modalFirstComment)
          ? { firstComment: coerceFirstCommentField(modalFirstComment) }
          : {}),
      });
      // Phase 4.B: dropped browser-side daemon-upsert + daemon-upsert-reel
      // calls. addScheduled (above) already syncs the row to Hub including
      // bunnyUrls via lib/schedule/hub-client.ts. publish-due reads from
      // the Hub via /api/v1/internal/schedule/due — no .data/ writes needed
      // on this client.
      setPendingDrop(null);
    } finally {
      setScheduleSaving(false);
    }
  }, [
    addScheduled,
    findExternalVideo,
    modalCaption,
    modalFirstComment,
    pendingDrop,
    modalScheduleKind,
    postFb,
    postIg,
    postYt,
    resolveSnapshot,
    timeStr,
    queue,
    queueSnapshots,
    youtubeConfigured,
  ]);

  /**
   * Phase 4.B — `syncDaemonForEntry` is a no-op. Move/edit flows on the
   * calendar still hit Hub via `moveScheduled` in `useScheduleStore` (which
   * calls `upsertScheduledPostToHub` automatically). The legacy daemon
   * writes to `.data/daemon-schedule.json` are no longer needed.
   *
   * Kept as a no-op (rather than deleted) so call sites in this file don't
   * need to be touched in this commit; Phase 4.C removes both the
   * placeholder and the call sites.
   */
  const syncDaemonForEntry = useCallback(
    async (_entry: ScheduledCarouselPost): Promise<void> => {
      // intentionally empty — see comment above
    },
    [],
  );

  const confirmMoveSchedule = useCallback(async () => {
    if (!moveEntry || moveSaving) return;
    const unix = Math.floor(new Date(moveTimeLocal).getTime() / 1000);
    if (!Number.isFinite(unix) || unix <= 0) return;
    setMoveSaving(true);
    try {
      const updated: ScheduledCarouselPost = {
        ...moveEntry,
        publishAtUnix: unix,
      };
      moveScheduledInStore(moveEntry.id, unix);
      await syncDaemonForEntry(updated);
      setMoveEntry(null);
    } finally {
      setMoveSaving(false);
    }
  }, [
    moveEntry,
    moveTimeLocal,
    moveSaving,
    moveScheduledInStore,
    syncDaemonForEntry,
  ]);

  const publishToMeta = useCallback(
    async (entry: ScheduledCarouselPost) => {
      setPublishMessage(null);
      setPublishBusyId(entry.id);
      try {
        const r = await runPublishEntryToMeta(
          entry,
          resolveSnapshot,
          (id) => {
            const qRow = queue.find((q) => q.id === id);
            if (qRow?.shortOutputFile) return qRow.shortOutputFile;
            return findExternalVideo(id)?.file ?? null;
          }
        );
        if (!r.ok) {
          setPublishMessage(r.message);
          return;
        }
        const parts: string[] = [];
        if (r.instagramMediaId) parts.push(`Instagram ${r.instagramMediaId}`);
        if (r.facebookPostId) parts.push(`Facebook ${r.facebookPostId}`);
        if (r.youtubeVideoId) parts.push(`YouTube ${r.youtubeVideoId}`);
        const commentNote = firstCommentPublishNote(r);
        const base = parts.length
          ? `Scheduled with Meta: ${parts.join(" · ")}`
          : "Sent to Meta.";
        setPublishMessage(
          commentNote ? `${base} ${commentNote}` : base
        );
      } catch (e) {
        setPublishMessage(e instanceof Error ? e.message : "Network error.");
      } finally {
        setPublishBusyId(null);
      }
    },
    [resolveSnapshot, queue, findExternalVideo]
  );

  const cells = useMemo(() => calendarCells(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const modalSnapPeek = pendingDrop?.queueItemId
    ? peekQueueSnapshot(pendingDrop.queueItemId)
    : null;
  const pendingExternalVideo = pendingDrop?.externalVideoId
    ? findExternalVideo(pendingDrop.externalVideoId)
    : null;
  const isExternalScheduleModal = Boolean(pendingDrop?.externalVideoId);
  const modalPhotoAvailable = photoAssetReadyForSchedule(modalSnapPeek);
  const modalCarouselReady =
    !!modalSnapPeek?.zipBase64 &&
    pickSlidePreviewPngsForCalendar(
      modalSnapPeek,
      postIg,
      postFb
    ).length > 0;
  const modalShortAvailable = isExternalScheduleModal
    ? Boolean(pendingExternalVideo)
    : Boolean(
        pendingDrop &&
          queue.find((q) => q.id === pendingDrop.queueItemId)?.shortOutputFile
      );
  const canConfirmSchedule =
    !!pendingDrop &&
    (postIg ||
      postFb ||
      (modalScheduleKind === "short" && postYt && youtubeConfigured === true)) &&
    !scheduleSaving &&
    (isExternalScheduleModal
      ? Boolean(pendingExternalVideo)
      : (modalScheduleKind !== "photo" || modalPhotoAvailable) &&
        (modalScheduleKind !== "carousel" || modalCarouselReady) &&
        (modalScheduleKind !== "short" || modalShortAvailable));

  const timeModalKindPill = scheduleKindPillModal(modalScheduleKind);

  const detailKind = detailEntry ? scheduleItemKind(detailEntry) : "carousel";
  const detailKindPill = scheduleKindPillModal(detailKind);
  const detailPublished = detailEntry
    ? isScheduleDaemonPublished(detailEntry, daemonStatusById)
    : false;
  const canSaveDetail =
    !!detailEntry &&
    !detailSaving &&
    !detailPublished &&
    (detailPostIg ||
      detailPostFb ||
      (detailKind === "short" && detailPostYt && youtubeConfigured === true));

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Schedule posts
          </h1>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(200px,280px)_1fr]">
        <div className="space-y-4">
          <ExternalCalendarVideosPanel
            videos={externalVideos}
            uploadInputId={externalUploadInputId}
            onFilesSelected={addExternalVideos}
            onRemove={removeExternalVideo}
          />
          <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Ready to schedule
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Drag a video onto a day, or click + on a day, then pick carousel,
            photo, or short in the dialog.
          </p>
          <ul className="mt-4 space-y-3">
            {doneQueue.length === 0 ? (
              <li className="text-sm text-stone-600">No completed videos yet.</li>
            ) : (
              doneQueue.map((q) => (
                <li key={q.id}>
                  <ReadyToScheduleVideoRow
                    q={q}
                    snap={queueSnapshots[q.id] ?? null}
                    mode="drag"
                    resolveSnapshot={resolveSnapshot}
                  />
                </li>
              ))
            )}
          </ul>
        </section>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous month"
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
              onClick={() =>
                setViewMonth(
                  new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)
                )
              }
            >
              ‹
            </button>
            <span className="text-base font-semibold text-stone-900">{monthLabel}</span>
            <button
              type="button"
              aria-label="Next month"
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
              onClick={() =>
                setViewMonth(
                  new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)
                )
              }
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) => {
              if (cell.kind === "empty") {
                return <div key={`e-${idx}`} className="min-h-[88px]" />;
              }
              const { day } = cell;
              const key = localDateKey(
                viewMonth.getFullYear(),
                viewMonth.getMonth(),
                day
              );
              const dayItems = itemsByDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className="flex min-h-[112px] flex-col rounded-lg border border-stone-100 bg-stone-50/50 p-1 transition hover:border-palette-teal/40 hover:bg-palette-pale/20"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDayPickTarget(null);

                    const raw = e.dataTransfer.getData(DRAG_MIME);
                    const parsed = parseScheduleDragPayload(raw);
                    if (parsed) {
                      if ("externalVideoId" in parsed) {
                        const ext = findExternalVideo(parsed.externalVideoId);
                        if (!ext) return;
                        openTimeModal({
                          externalVideoId: parsed.externalVideoId,
                          videoLabel: externalVideoLabel(ext.file),
                          year: viewMonth.getFullYear(),
                          monthIndex: viewMonth.getMonth(),
                          day,
                          scheduleKind: "short",
                        });
                        return;
                      }
                      const dragged = queue.find(
                        (q) => q.id === parsed.queueItemId
                      );
                      const label =
                        e.dataTransfer.getData("text/plain") ||
                        (dragged ? queueItemScheduleLabel(dragged) : "Video");
                      openTimeModal({
                        queueItemId: parsed.queueItemId,
                        videoLabel: label,
                        year: viewMonth.getFullYear(),
                        monthIndex: viewMonth.getMonth(),
                        day,
                        scheduleKind: parsed.scheduleKind,
                      });
                      return;
                    }

                    const droppedFiles = Array.from(e.dataTransfer.files ?? []);
                    const videoFiles = filterExternalCalendarVideos(droppedFiles);
                    if (videoFiles.length > 0) {
                      const video = videoFiles[0]!;
                      openTimeModal({
                        externalVideoId: video.id,
                        externalVideo: video,
                        videoLabel: externalVideoLabel(video.file),
                        year: viewMonth.getFullYear(),
                        monthIndex: viewMonth.getMonth(),
                        day,
                      });
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-0.5">
                    <span className="text-xs font-semibold text-stone-700">
                      {day}
                    </span>
                    <button
                      type="button"
                      disabled={!hasSchedulableDoneQueue}
                      aria-label={
                        !hasSchedulableDoneQueue
                          ? `No schedulable videos for day ${day}`
                          : `Add a scheduled post on ${day}`
                      }
                      title={
                        !hasSchedulableDoneQueue
                          ? doneQueue.length === 0 && externalVideos.length === 0
                            ? "Upload a video or finish processing on Multiplier first"
                            : "Generate carousel, photo, or short on Multiplier first"
                          : "Schedule a post"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailEntry(null);
                        setDayPickTarget({
                          year: viewMonth.getFullYear(),
                          monthIndex: viewMonth.getMonth(),
                          day,
                        });
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-stone-200/90 bg-white text-sm font-semibold leading-none text-stone-600 transition hover:border-palette-teal/50 hover:bg-palette-pale/30 hover:text-palette-depth disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <ul className="mt-1 flex flex-1 flex-col gap-1 overflow-hidden">
                    {dayItems.map((it) => {
                      const { srcs, moreCount } = scheduleItemThumbDisplay(
                        it,
                        peekQueueSnapshot
                      );
                      const dayKindPill = scheduleKindPillCalendar(
                        scheduleItemKind(it)
                      );
                      return (
                        <li
                          key={it.id}
                          className="rounded bg-palette-moss/15 px-1 py-1 text-[10px] font-medium text-stone-800"
                        >
                          <button
                            type="button"
                            onClick={() => openDetailModal(it)}
                            className="w-full rounded text-left transition hover:opacity-90"
                            title={`${schedulePrimaryTitle(it)} · ${it.videoLabel} — click for caption & platforms`}
                          >
                            {srcs.length > 0 && (
                              <div className="mb-0.5 flex items-center gap-0.5 overflow-x-auto">
                                {srcs.map((src, i) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    key={i}
                                    src={src}
                                    alt=""
                                    className="h-7 w-7 shrink-0 rounded border border-stone-200/80 object-cover"
                                  />
                                ))}
                                {moreCount > 0 && (
                                  <span className="shrink-0 rounded border border-stone-300/80 bg-white/90 px-1 py-0.5 text-[9px] font-semibold text-stone-600">
                                    +{moreCount}
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex min-w-0 flex-col items-start gap-0.5">
                              <span className={dayKindPill.className}>
                                {dayKindPill.label}
                              </span>
                              <p className="w-full min-w-0 truncate leading-tight">
                                {schedulePrimaryTitle(it)}
                              </p>
                            </div>
                          </button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <DaemonPublishStatusSpan
                              entry={it}
                              byId={daemonStatusById}
                              variant="cell"
                            />
                            <button
                              type="button"
                              disabled={
                                publishLocked ||
                                isScheduleDaemonPublished(it, daemonStatusById)
                              }
                              title={
                                isScheduleDaemonPublished(it, daemonStatusById)
                                  ? "Already auto-published"
                                  : "Move to another time"
                              }
                              onClick={() => {
                                setPendingDrop(null);
                                setDayPickTarget(null);
                                setDetailEntry(null);
                                setMoveEntry(it);
                                setMoveTimeLocal(
                                  toDatetimeLocalValue(it.publishAtUnix)
                                );
                              }}
                              className="rounded border border-stone-300/80 bg-white/90 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Move
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        {publishMessage && (
          <p className="mt-2 whitespace-pre-line rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
            {publishMessage}
          </p>
        )}
        {items.length > 0 && (
          <p className="mt-2 text-xs text-stone-500">
            <span className="font-medium text-stone-700">Move</span> changes the
            slot in this browser and on the server publish list (when the daemon
            secret is set). Posts already{" "}
            <span className="font-medium text-stone-700">auto-published</span>{" "}
            (Published badge) cannot be moved here.
          </p>
        )}
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-stone-600">Nothing scheduled yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {items.map((it) => {
              const when = new Date(it.publishAtUnix * 1000);
              const { srcs, moreCount } = scheduleItemThumbDisplay(
                it,
                peekQueueSnapshot
              );
              const rowKindPill = scheduleKindPillRow(scheduleItemKind(it));
              return (
                <li
                  key={it.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 gap-3">
                    {srcs.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1 self-start">
                        {srcs.map((src, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={src}
                            alt=""
                            className="h-14 w-14 rounded-lg border border-stone-200 object-cover"
                          />
                        ))}
                        {moreCount > 0 && (
                          <span className="rounded-lg border border-stone-200 bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">
                            +{moreCount}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={rowKindPill.className}>
                        {rowKindPill.label}
                      </span>
                      <p
                        className="min-w-0 flex-1 truncate font-medium text-stone-900"
                        title={it.videoLabel}
                      >
                        {schedulePrimaryTitle(it)}
                      </p>
                      <DaemonPublishStatusSpan
                        entry={it}
                        byId={daemonStatusById}
                        variant="row"
                      />
                    </div>
                    <p className="text-xs text-stone-500">
                      {when.toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · IG {it.postToInstagram ? "on" : "off"} · FB{" "}
                      {it.postToFacebook ? "on" : "off"}
                      {scheduleItemKind(it) === "short" ? (
                        <>
                          {" "}
                          · YT {it.postToYouTube ? "on" : "off"}
                        </>
                      ) : null}
                    </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={publishLocked}
                      onClick={() => publishToMeta(it)}
                      className="rounded-lg bg-palette-moss px-3 py-2 text-xs font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
                    >
                      {publishBusyId === it.id ? "Sending…" : "Publish Now"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        publishLocked ||
                        isScheduleDaemonPublished(it, daemonStatusById)
                      }
                      title={
                        isScheduleDaemonPublished(it, daemonStatusById)
                          ? "Already auto-published — cannot reschedule here."
                          : "Change date and time"
                      }
                      onClick={() => {
                        setPendingDrop(null);
                        setDayPickTarget(null);
                        setDetailEntry(null);
                        setMoveEntry(it);
                        setMoveTimeLocal(toDatetimeLocalValue(it.publishAtUnix));
                      }}
                      className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Move
                    </button>
                    <button
                      type="button"
                      onClick={() => removeScheduled(it.id)}
                      className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dayPickTarget && !pendingDrop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="day-pick-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => setDayPickTarget(null)}
          />
          <div className="relative z-10 flex max-h-[min(90vh,560px)] w-full max-w-sm flex-col rounded-2xl border border-stone-200 bg-white shadow-xl">
            <div className="shrink-0 border-b border-stone-100 px-5 py-4">
              <h2
                id="day-pick-dialog-title"
                className="text-lg font-semibold text-stone-900"
              >
                Schedule for {dayPickDateLabel}
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                Choose a video from Ready to schedule, or an uploaded file.
              </p>
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {externalVideos.length > 0 ? (
                <>
                  <li className="text-[10px] font-semibold uppercase tracking-wide text-violet-800/70">
                    Uploaded videos
                  </li>
                  {externalVideos.map((video) => (
                    <li key={video.id}>
                      <ExternalVideoPickRow
                        video={video}
                        onPick={() => pickExternalVideoForDay(video)}
                      />
                    </li>
                  ))}
                </>
              ) : null}
              {doneQueue.length === 0 && externalVideos.length === 0 ? (
                <li className="text-sm text-stone-600">
                  Upload a video above, or finish processing on Multiplier first.
                </li>
              ) : doneQueue.length === 0 ? null : (
                <>
                  {externalVideos.length > 0 ? (
                    <li className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                      From Multiplier
                    </li>
                  ) : null}
                  {doneQueue.map((q) => (
                  <li key={q.id}>
                    <ReadyToScheduleVideoRow
                      q={q}
                      snap={queueSnapshots[q.id] ?? null}
                      mode="pick"
                      resolveSnapshot={resolveSnapshot}
                      onPick={() => pickVideoForDay(q)}
                    />
                  </li>
                  ))}
                </>
              )}
            </ul>
            <div className="shrink-0 border-t border-stone-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setDayPickTarget(null)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDrop && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="time-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => setPendingDrop(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2 id="time-dialog-title" className="text-lg font-semibold text-stone-900">
              What time?
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              <span className="font-medium text-stone-800">
                {isExternalScheduleModal && pendingExternalVideo
                  ? displayHookFromExternalVideo(pendingExternalVideo.file)
                  : (() => {
                      const row = queue.find(
                        (q) => q.id === pendingDrop.queueItemId
                      );
                      return row
                        ? scheduleTitleForQueueItem(
                            modalScheduleKind,
                            modalSnapPeek,
                            row
                          )
                        : displayHookForSchedule(
                            modalScheduleKind,
                            modalSnapPeek,
                            pendingDrop.videoLabel
                          );
                    })()}
              </span>
              <span className={timeModalKindPill.className}>
                {timeModalKindPill.label}
              </span>
              <span className="mt-1 block text-stone-500">
                File: {pendingDrop.videoLabel}
              </span>
              {isExternalScheduleModal ? (
                <span className="mt-0.5 block text-xs text-violet-800/80">
                  Uploads to storage when you save — auto-publish works after
                  that.
                </span>
              ) : null}
              <span className="mt-0.5 block">
                {new Date(
                  pendingDrop.year,
                  pendingDrop.monthIndex,
                  pendingDrop.day
                ).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </p>
            {!isExternalScheduleModal ? (
            <div className="mt-4">
              <p className="text-sm font-medium text-stone-800">Post type</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!pendingDrop.queueItemId) return;
                    setModalScheduleKind("carousel");
                    applyModalKindDefaults(
                      "carousel",
                      resolveSnapshot(pendingDrop.queueItemId),
                      setModalCaption,
                      setPostIg,
                      setPostFb,
                      setPostYt,
                      false
                    );
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    modalScheduleKind === "carousel"
                      ? "border-palette-moss bg-palette-moss/15 text-palette-depth ring-2 ring-palette-moss/40"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Carousel
                </button>
                <button
                  type="button"
                  disabled={!modalPhotoAvailable}
                  title={
                    modalPhotoAvailable
                      ? "Single 4:5 image post"
                      : "Generate the image post on the home page first"
                  }
                  onClick={() => {
                    if (!modalPhotoAvailable || !pendingDrop.queueItemId) return;
                    setModalScheduleKind("photo");
                    applyModalKindDefaults(
                      "photo",
                      resolveSnapshot(pendingDrop.queueItemId),
                      setModalCaption,
                      setPostIg,
                      setPostFb,
                      setPostYt,
                      false
                    );
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    modalScheduleKind === "photo"
                      ? "border-sky-400 bg-sky-50 text-sky-950 ring-2 ring-sky-300/50"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Photo
                </button>
                <button
                  type="button"
                  disabled={!modalShortAvailable}
                  title={
                    modalShortAvailable
                      ? "Video to Short reel (IG Reels + optional Page video)"
                      : "Generate the short on the home page first"
                  }
                  onClick={() => {
                    if (!modalShortAvailable || !pendingDrop?.queueItemId) return;
                    setModalScheduleKind("short");
                    applyModalKindDefaults(
                      "short",
                      resolveSnapshot(pendingDrop.queueItemId),
                      setModalCaption,
                      setPostIg,
                      setPostFb,
                      setPostYt,
                      youtubeConfigured === true
                    );
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    modalScheduleKind === "short"
                      ? "border-violet-400 bg-violet-50 text-violet-950 ring-2 ring-violet-300/50"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Short
                </button>
              </div>
            </div>
            ) : null}
            <label className="mt-4 block text-sm font-medium text-stone-800">
              Time
              <input
                type="time"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-stone-800">
              Caption
              <textarea
                value={modalCaption}
                onChange={(e) => setModalCaption(e.target.value)}
                rows={4}
                className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-stone-800">
              First comment{" "}
              <span className="font-normal text-stone-500">(optional)</span>
              <textarea
                value={modalFirstComment}
                onChange={(e) =>
                  setModalFirstComment(
                    e.target.value.slice(0, MAX_DEFAULT_FIRST_COMMENT_CHARS)
                  )
                }
                rows={2}
                placeholder="Link, CTA, or extra context…"
                className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs font-normal text-stone-400">
                {modalFirstComment.length.toLocaleString()} /{" "}
                {MAX_DEFAULT_FIRST_COMMENT_CHARS.toLocaleString()}
              </span>
              <span className="mt-1 block text-xs font-normal text-stone-500">
                Posted automatically after publish. Pin it in Instagram or Facebook
                if you want it at the top — the API cannot pin for you.
              </span>
            </label>
            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium text-stone-800">Destinations</legend>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={postIg}
                  onChange={(e) => setPostIg(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss"
                />
                Instagram
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={postFb}
                  onChange={(e) => setPostFb(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss"
                />
                Facebook Page
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  modalScheduleKind === "short"
                    ? "text-stone-700"
                    : "cursor-not-allowed text-stone-400"
                }`}
                title={
                  modalScheduleKind === "short"
                    ? "Upload Short MP4 to your YouTube channel"
                    : "YouTube uses the Short MP4 — choose Short as the post type"
                }
              >
                <input
                  type="checkbox"
                  disabled={modalScheduleKind !== "short"}
                  checked={modalScheduleKind === "short" && postYt}
                  onChange={(e) => setPostYt(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss disabled:opacity-50"
                />
                YouTube (Short)
              </label>
              {modalScheduleKind === "short" &&
                postYt &&
                youtubeConfigured === false && (
                  <p className="text-xs text-amber-800">
                    Connect YouTube (see home &quot;Publish now…&quot; flow) and add{" "}
                    <code className="rounded bg-amber-100/80 px-1">
                      GOOGLE_YOUTUBE_REFRESH_TOKEN
                    </code>{" "}
                    to enable this destination.
                  </p>
                )}
            </fieldset>
            {scheduleUploadError ? (
              <p className="mt-3 text-sm text-red-700">{scheduleUploadError}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDrop(null)}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmSchedule()}
                disabled={!canConfirmSchedule}
                className="rounded-xl bg-palette-moss px-4 py-2 text-sm font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
              >
                {scheduleSaving
                  ? isExternalScheduleModal
                    ? "Uploading…"
                    : "Saving…"
                  : "Add to schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailEntry && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => !detailSaving && setDetailEntry(null)}
          />
          <div className="relative z-10 max-h-[min(90vh,640px)] w-full max-w-md overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2
              id="detail-dialog-title"
              className="text-lg font-semibold text-stone-900"
            >
              Scheduled post
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              <span className="font-medium text-stone-800">
                {schedulePrimaryTitle(detailEntry)}
              </span>
              <span className={detailKindPill.className}>
                {detailKindPill.label}
              </span>
              <span className="mt-1 block text-stone-500">
                File: {detailEntry.videoLabel}
              </span>
              <span className="mt-0.5 block">
                {new Date(detailEntry.publishAtUnix * 1000).toLocaleString(
                  undefined,
                  {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }
                )}
              </span>
            </p>
            {detailPublished && (
              <p className="mt-3 text-sm text-amber-800">
                This post was already published — caption and destinations are
                read-only here.
              </p>
            )}
            <label className="mt-4 block text-sm font-medium text-stone-800">
              Caption
              <textarea
                value={detailCaption}
                onChange={(e) => setDetailCaption(e.target.value)}
                readOnly={detailPublished}
                rows={4}
                className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 px-3 py-2 text-sm read-only:bg-stone-50"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-stone-800">
              First comment{" "}
              <span className="font-normal text-stone-500">(optional)</span>
              <textarea
                value={detailFirstComment}
                onChange={(e) =>
                  setDetailFirstComment(
                    e.target.value.slice(0, MAX_DEFAULT_FIRST_COMMENT_CHARS)
                  )
                }
                readOnly={detailPublished}
                rows={2}
                placeholder="Link, CTA, or extra context…"
                className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 px-3 py-2 text-sm read-only:bg-stone-50"
              />
            </label>
            <fieldset className="mt-4 space-y-2" disabled={detailPublished}>
              <legend className="text-sm font-medium text-stone-800">
                Destinations
              </legend>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={detailPostIg}
                  onChange={(e) => setDetailPostIg(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss"
                />
                Instagram
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={detailPostFb}
                  onChange={(e) => setDetailPostFb(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss"
                />
                Facebook Page
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  detailKind === "short"
                    ? "text-stone-700"
                    : "cursor-not-allowed text-stone-400"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={detailKind !== "short"}
                  checked={detailKind === "short" && detailPostYt}
                  onChange={(e) => setDetailPostYt(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss disabled:opacity-50"
                />
                YouTube (Short)
              </label>
              {detailKind === "short" &&
                detailPostYt &&
                youtubeConfigured === false && (
                  <p className="text-xs text-amber-800">
                    YouTube is not connected — this destination will not publish
                    until configured.
                  </p>
                )}
            </fieldset>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={detailSaving}
                onClick={() => setDetailEntry(null)}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
              >
                {detailPublished ? "Close" : "Cancel"}
              </button>
              {!detailPublished && (
                <button
                  type="button"
                  onClick={() => confirmDetailUpdate()}
                  disabled={!canSaveDetail}
                  className="rounded-xl bg-palette-moss px-4 py-2 text-sm font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
                >
                  {detailSaving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {moveEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => !moveSaving && setMoveEntry(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2
              id="move-dialog-title"
              className="text-lg font-semibold text-stone-900"
            >
              Move post
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              <span className="font-medium text-stone-800">
                {schedulePrimaryTitle(moveEntry)}
              </span>
              <span className="mt-1 block text-xs text-stone-500">
                {moveEntry.videoLabel}
              </span>
            </p>
            {isScheduleDaemonPublished(moveEntry, daemonStatusById) ? (
              <p className="mt-3 text-sm text-red-700">
                This post was already auto-published and cannot be rescheduled
                here.
              </p>
            ) : (
              <label className="mt-4 block text-sm font-medium text-stone-800">
                New date and time
                <input
                  type="datetime-local"
                  value={moveTimeLocal}
                  onChange={(e) => setMoveTimeLocal(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal"
                />
              </label>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={moveSaving}
                onClick={() => setMoveEntry(null)}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  moveSaving ||
                  !moveTimeLocal.trim() ||
                  Number.isNaN(new Date(moveTimeLocal).getTime()) ||
                  isScheduleDaemonPublished(moveEntry, daemonStatusById)
                }
                onClick={() => void confirmMoveSchedule()}
                className="rounded-xl bg-palette-moss px-4 py-2 text-sm font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
              >
                {moveSaving ? "Saving…" : "Save new time"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
