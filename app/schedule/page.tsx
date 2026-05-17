"use client";

import { ContentMultiplierHomeLink } from "@/app/components/ContentMultiplierMark";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useCarouselWorkspace,
  type QueueCarouselSnapshot,
} from "@/context/carousel-workspace-context";
import { useScheduleStore, type ScheduledCarouselPost } from "@/context/schedule-context";
import {
  type ScheduleContentKind,
  displayHookForSchedule,
  downscalePngBase64ToJpegDataUrl,
  pickPhotoPreviewPngsForCalendar,
  pickSlidePreviewPngsForCalendar,
  slideCountForCalendar,
} from "@/lib/schedule/calendar-preview-thumbs";
import {
  postMetaCarouselPublish,
  postMetaReelPublish,
} from "@/lib/meta/publish-meta-client";
import type { DaemonScheduleEntry } from "@/lib/schedule/daemon-schema";
import {
  fetchDaemonStatuses,
  syncDaemonDelete,
  syncDaemonUpsert,
  syncDaemonUpsertReel,
  type DaemonPublishRowStatus,
} from "@/lib/schedule/daemon-client";
import {
  captionFromImagePostSnapshot,
  captionFromSnapshot,
  imagePostSlideForMeta,
  slidesForMetaFromZipOrSnapshot,
} from "@/lib/schedule/slides-for-meta-from-snapshot";
import { clientApiPath } from "@/lib/client-api-path";
import { postYoutubeShortPublish } from "@/lib/youtube/publish-youtube-client";

const DRAG_MIME = "application/x-video-studio-queue-id";

function parseScheduleDrag(
  raw: string
): { queueItemId: string; scheduleKind: ScheduleContentKind } | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as {
        queueItemId?: string;
        scheduleKind?: string;
      };
      const id = j.queueItemId;
      const k = j.scheduleKind;
      if (
        typeof id === "string" &&
        id.length > 0 &&
        (k === "carousel" || k === "photo" || k === "short")
      ) {
        return { queueItemId: id, scheduleKind: k };
      }
    } catch {
      return null;
    }
    return null;
  }
  if (/^[0-9a-f-]{36}$/i.test(t)) {
    return { queueItemId: t, scheduleKind: "carousel" };
  }
  return null;
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
    }
  | { ok: false; message: string };

/** One scheduled row → Meta (same behavior as single Send). */
async function runPublishEntryToMeta(
  entry: ScheduledCarouselPost,
  resolveSnapshot: (queueItemId: string) => QueueCarouselSnapshot | null,
  getShortFile: (queueItemId: string) => File | null | undefined
): Promise<PublishEntryResult> {
  const snap = resolveSnapshot(entry.queueItemId);
  const kind = scheduleItemKind(entry);
  let slides: string[];
  if (kind === "short") {
    const vid = getShortFile(entry.queueItemId) ?? undefined;
    if (!vid) {
      return {
        ok: false,
        message:
          "Short MP4 is not in memory. Open this video on the home page in the same session (or re-run processing) so the reel file is available, then send again.",
      };
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
    };
  }
  if (kind === "photo") {
    if (!snap) {
      return {
        ok: false,
        message:
          "Snapshot is missing. Open this video on the home page and try again.",
      };
    }
    slides = imagePostSlideForMeta(snap);
    if (slides.length === 0) {
      return {
        ok: false,
        message:
          "Single-image post is missing. Open this video on the home page and ensure the image post generated.",
      };
    }
  } else {
    if (!snap) {
      return {
        ok: false,
        message:
          "Carousel data is missing for this video. Open it on the home page and try again.",
      };
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
    removeScheduled: removeScheduledFromStore,
  } = useScheduleStore();

  const removeScheduled = useCallback(
    async (id: string) => {
      removeScheduledFromStore(id);
      await syncDaemonDelete(id);
    },
    [removeScheduledFromStore]
  );

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [pendingDrop, setPendingDrop] = useState<{
    queueItemId: string;
    videoLabel: string;
    year: number;
    monthIndex: number;
    day: number;
  } | null>(null);
  const [timeStr, setTimeStr] = useState("09:00");
  const [modalCaption, setModalCaption] = useState("");
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
      queueItemId: string,
      videoLabel: string,
      year: number,
      monthIndex: number,
      day: number,
      scheduleKind: ScheduleContentKind
    ) => {
      const snap = resolveSnapshot(queueItemId);
      setModalScheduleKind(scheduleKind);
      if (scheduleKind === "photo" && snap) {
        setModalCaption(captionFromImagePostSnapshot(snap));
      } else if (scheduleKind === "short" && snap) {
        const c = snap.socialCaption?.trim();
        setModalCaption(
          c && c.length > 0
            ? c
            : captionFromImagePostSnapshot(snap) || captionFromSnapshot(snap)
        );
      } else {
        setModalCaption(snap ? captionFromSnapshot(snap) : "");
      }
      setTimeStr("09:00");
      if (scheduleKind === "carousel" && snap) {
        const anySlides =
          pickSlidePreviewPngsForCalendar(snap, true, true).length > 0;
        setPostIg(anySlides);
        setPostFb(anySlides);
      } else {
        setPostIg(true);
        setPostFb(true);
      }
      setPostYt(scheduleKind === "short" && youtubeConfigured === true);
      setPendingDrop({ queueItemId, videoLabel, year, monthIndex, day });
    },
    [resolveSnapshot, youtubeConfigured]
  );

  useEffect(() => {
    if (!pendingDrop || modalScheduleKind !== "short") return;
    if (youtubeConfigured === true) setPostYt(true);
    else if (youtubeConfigured === false) setPostYt(false);
  }, [pendingDrop, modalScheduleKind, youtubeConfigured]);

  const confirmSchedule = useCallback(async () => {
    if (!pendingDrop) return;
    const snapPreflight = resolveSnapshot(pendingDrop.queueItemId);
    if (modalScheduleKind === "photo") {
      if (!snapPreflight?.imagePost?.imageBase64) return;
    } else if (modalScheduleKind === "short") {
      const qi = queue.find((q) => q.id === pendingDrop.queueItemId);
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
      const snap = resolveSnapshot(pendingDrop.queueItemId);
      if (!snap) {
        if (modalScheduleKind !== "short") {
          return;
        }
        const shortRow = addScheduled({
          queueItemId: pendingDrop.queueItemId,
          videoLabel: pendingDrop.videoLabel,
          publishAtUnix: Math.floor(when.getTime() / 1000),
          caption: modalCaption.trim(),
          postToInstagram: postIg,
          postToFacebook: postFb,
          postToYouTube: postYt,
          slideCount: 1,
          calendarThumbJpegs: undefined,
          scheduleKind: "short",
          displayHook: displayHookForSchedule(
            "short",
            null,
            pendingDrop.videoLabel
          ),
        });
        const shortFileNoSnap = queue.find(
          (q) => q.id === pendingDrop.queueItemId
        )?.shortOutputFile;
        if (shortFileNoSnap) {
          void syncDaemonUpsertReel(
            { ...shortRow, publishSlidesBase64: undefined },
            shortFileNoSnap
          );
        }
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
      const displayHook = displayHookForSchedule(
        modalScheduleKind,
        snap,
        pendingDrop.videoLabel
      );
      const row = addScheduled({
        queueItemId: pendingDrop.queueItemId,
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
      });
      const slidesForDaemon =
        modalScheduleKind === "photo"
          ? imagePostSlideForMeta(snap)
          : modalScheduleKind === "short"
            ? []
            : await slidesForMetaFromZipOrSnapshot(snap, postIg, postFb);
      if (modalScheduleKind === "short") {
        const shortFile = queue.find((q) => q.id === pendingDrop.queueItemId)
          ?.shortOutputFile;
        if (shortFile) {
          void syncDaemonUpsertReel(
            { ...row, publishSlidesBase64: undefined },
            shortFile
          );
        }
      } else if (slidesForDaemon.length > 0) {
        const daemonEntry: DaemonScheduleEntry = {
          ...row,
          publishSlidesBase64: slidesForDaemon,
        };
        void syncDaemonUpsert(daemonEntry);
      }
      setPendingDrop(null);
    } finally {
      setScheduleSaving(false);
    }
  }, [
    addScheduled,
    modalCaption,
    pendingDrop,
    modalScheduleKind,
    postFb,
    postIg,
    postYt,
    resolveSnapshot,
    timeStr,
    queue,
  ]);

  const syncDaemonForEntry = useCallback(
    async (entry: ScheduledCarouselPost) => {
      const kind = scheduleItemKind(entry);
      if (kind === "short") {
        const shortFile = queue.find((q) => q.id === entry.queueItemId)
          ?.shortOutputFile;
        if (shortFile) {
          await syncDaemonUpsertReel(
            { ...entry, publishSlidesBase64: undefined },
            shortFile
          );
        }
        return;
      }
      const snap = resolveSnapshot(entry.queueItemId);
      if (!snap) return;
      const slides =
        kind === "photo"
          ? imagePostSlideForMeta(snap)
          : await slidesForMetaFromZipOrSnapshot(
              snap,
              entry.postToInstagram,
              entry.postToFacebook
            );
      if (slides.length > 0) {
        const daemonEntry: DaemonScheduleEntry = {
          ...entry,
          publishSlidesBase64: slides,
        };
        await syncDaemonUpsert(daemonEntry);
      }
    },
    [queue, resolveSnapshot]
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
          (id) => queue.find((q) => q.id === id)?.shortOutputFile
        );
        if (!r.ok) {
          setPublishMessage(r.message);
          return;
        }
        const parts: string[] = [];
        if (r.instagramMediaId) parts.push(`Instagram ${r.instagramMediaId}`);
        if (r.facebookPostId) parts.push(`Facebook ${r.facebookPostId}`);
        if (r.youtubeVideoId) parts.push(`YouTube ${r.youtubeVideoId}`);
        setPublishMessage(
          parts.length ? `Scheduled with Meta: ${parts.join(" · ")}` : "Sent to Meta."
        );
      } catch (e) {
        setPublishMessage(e instanceof Error ? e.message : "Network error.");
      } finally {
        setPublishBusyId(null);
      }
    },
    [resolveSnapshot, queue]
  );

  const cells = useMemo(() => calendarCells(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const modalSnapPeek = pendingDrop
    ? peekQueueSnapshot(pendingDrop.queueItemId)
    : null;
  const modalPhotoAvailable = !!(
    modalSnapPeek?.imagePost?.imageBase64 &&
    modalSnapPeek.imagePost.imageBase64.length > 0
  );
  const modalCarouselReady =
    !!modalSnapPeek?.zipBase64 &&
    pickSlidePreviewPngsForCalendar(
      modalSnapPeek,
      postIg,
      postFb
    ).length > 0;
  const modalShortAvailable = Boolean(
    pendingDrop &&
      queue.find((q) => q.id === pendingDrop.queueItemId)?.shortOutputFile
  );
  const canConfirmSchedule =
    !!pendingDrop &&
    (postIg ||
      postFb ||
      (modalScheduleKind === "short" && postYt && youtubeConfigured === true)) &&
    !scheduleSaving &&
    (modalScheduleKind !== "photo" || modalPhotoAvailable) &&
    (modalScheduleKind !== "carousel" || modalCarouselReady) &&
    (modalScheduleKind !== "short" || modalShortAvailable);

  const timeModalKindPill = scheduleKindPillModal(modalScheduleKind);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ContentMultiplierHomeLink className="inline-flex items-center gap-2 text-sm font-medium text-palette-depth hover:text-stone-900" />
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">
            Schedule posts
          </h1>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(200px,280px)_1fr]">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Ready to schedule
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Only videos marked Done. Up to three rows: carousel, 4:5 photo, and
            Video to Short reel (when generated).
          </p>
          <ul className="mt-4 space-y-4">
            {doneQueue.length === 0 ? (
              <li className="text-sm text-stone-600">No completed videos yet.</li>
            ) : (
              doneQueue.map((q) => {
                const snap = queueSnapshots[q.id] ?? null;
                const carThumb = snap?.firstSlidePreviewBase64 ?? null;
                const phB64 = snap?.imagePost?.imageBase64;
                const photoReady = typeof phB64 === "string" && phB64.length > 0;
                const carTitle = displayHookForSchedule(
                  "carousel",
                  snap,
                  q.file.name
                );
                const phTitle = displayHookForSchedule("photo", snap, q.file.name);
                const shortReady = Boolean(q.shortOutputFile);
                const shortTitle = displayHookForSchedule(
                  "short",
                  snap,
                  q.file.name
                );
                return (
                  <li key={q.id} className="space-y-2">
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          DRAG_MIME,
                          JSON.stringify({
                            queueItemId: q.id,
                            scheduleKind: "carousel",
                          })
                        );
                        e.dataTransfer.setData("text/plain", q.file.name);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="flex cursor-grab items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/80 p-2 active:cursor-grabbing"
                    >
                      {carThumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:image/png;base64,${carThumb}`}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-xs text-stone-500">
                          …
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-800">
                          {carTitle}
                        </p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-palette-depth">
                          Carousel
                        </p>
                      </div>
                    </div>
                    <div
                      draggable={photoReady}
                      onDragStart={(e) => {
                        if (!photoReady) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData(
                          DRAG_MIME,
                          JSON.stringify({
                            queueItemId: q.id,
                            scheduleKind: "photo",
                          })
                        );
                        e.dataTransfer.setData("text/plain", q.file.name);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className={`flex items-center gap-3 rounded-xl border border-dashed border-stone-200 bg-white/80 p-2 ${
                        photoReady
                          ? "cursor-grab active:cursor-grabbing"
                          : "cursor-not-allowed opacity-60"
                      }`}
                    >
                      {photoReady ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:image/png;base64,${phB64}`}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-[10px] text-stone-500">
                          —
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-800">
                          {phTitle}
                        </p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                          Photo
                        </p>
                        {!photoReady && (
                          <p className="mt-0.5 text-[10px] text-stone-500">
                            Open on home to generate
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      draggable={shortReady}
                      onDragStart={(e) => {
                        if (!shortReady) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData(
                          DRAG_MIME,
                          JSON.stringify({
                            queueItemId: q.id,
                            scheduleKind: "short",
                          })
                        );
                        e.dataTransfer.setData("text/plain", q.file.name);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className={`flex items-center gap-3 rounded-xl border border-dashed border-stone-200 bg-white/80 p-2 ${
                        shortReady
                          ? "cursor-grab active:cursor-grabbing"
                          : "cursor-not-allowed opacity-60"
                      }`}
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[10px] font-semibold text-white">
                        ▶
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-800">
                          {shortTitle}
                        </p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                          Short
                        </p>
                        {!shortReady && (
                          <p className="mt-0.5 text-[10px] text-stone-500">
                            Generate short on home first
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </section>

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
                    const raw = e.dataTransfer.getData(DRAG_MIME);
                    const parsed = parseScheduleDrag(raw);
                    if (!parsed) return;
                    const label =
                      e.dataTransfer.getData("text/plain") ||
                      queue.find((q) => q.id === parsed.queueItemId)?.file.name ||
                      "Video";
                    openTimeModal(
                      parsed.queueItemId,
                      label,
                      viewMonth.getFullYear(),
                      viewMonth.getMonth(),
                      day,
                      parsed.scheduleKind
                    );
                  }}
                >
                  <span className="text-xs font-semibold text-stone-700">{day}</span>
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
                          title={`${schedulePrimaryTitle(it)} · ${it.videoLabel}`}
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDrop(null);
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
                      {publishBusyId === it.id ? "Sending…" : "Send to Meta"}
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

      {pendingDrop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
                {displayHookForSchedule(
                  modalScheduleKind,
                  modalSnapPeek,
                  pendingDrop.videoLabel
                )}
              </span>
              <span className={timeModalKindPill.className}>
                {timeModalKindPill.label}
              </span>
              <span className="mt-1 block text-stone-500">
                File: {pendingDrop.videoLabel}
              </span>
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
            <div className="mt-4">
              <p className="text-sm font-medium text-stone-800">Post type</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalScheduleKind("carousel");
                    const s = resolveSnapshot(pendingDrop.queueItemId);
                    if (s) {
                      setModalCaption(captionFromSnapshot(s));
                      const any =
                        pickSlidePreviewPngsForCalendar(s, true, true).length > 0;
                      setPostIg(any);
                      setPostFb(any);
                    } else {
                      setPostIg(true);
                      setPostFb(true);
                    }
                    setPostYt(false);
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
                    if (!modalPhotoAvailable) return;
                    setModalScheduleKind("photo");
                    const s = resolveSnapshot(pendingDrop.queueItemId);
                    if (s) setModalCaption(captionFromImagePostSnapshot(s));
                    setPostIg(true);
                    setPostFb(true);
                    setPostYt(false);
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
                    if (!modalShortAvailable || !pendingDrop) return;
                    setModalScheduleKind("short");
                    const s = resolveSnapshot(pendingDrop.queueItemId);
                    if (s) {
                      const c = s.socialCaption?.trim();
                      setModalCaption(
                        c && c.length > 0
                          ? c
                          : captionFromImagePostSnapshot(s) ||
                            captionFromSnapshot(s)
                      );
                    }
                    setPostIg(true);
                    setPostFb(true);
                    setPostYt(youtubeConfigured === true);
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
                {scheduleSaving ? "Saving…" : "Add to schedule"}
              </button>
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
