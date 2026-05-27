"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type { ScheduleContentKind } from "@/lib/schedule/calendar-preview-thumbs";
import {
  deleteScheduledPostFromHub,
  listScheduledPostsFromHub,
  upsertScheduledPostToHub,
} from "@/lib/schedule/hub-client";
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";

function bunnyUrlsEqual(a?: BunnyAssetUrls, b?: BunnyAssetUrls): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const STORAGE_KEY = "video-studio-scheduled-carousels-v1";

export type { ScheduleContentKind };

export type ScheduledCarouselPost = {
  id: string;
  queueItemId: string;
  videoLabel: string;
  /** Unix seconds (local wall time interpreted when user picked date+time). */
  publishAtUnix: number;
  caption: string;
  postToInstagram: boolean;
  postToFacebook: boolean;
  /** Short / daemon: upload MP4 to YouTube when configured (optional). */
  postToYouTube?: boolean;
  createdAt: number;
  /** Slide count when scheduled (for badges). */
  slideCount?: number;
  /**
   * Small JPEG data URLs for calendar / list (max 5), built when adding to schedule.
   * Keeps localStorage smaller than full PNG slides.
   */
  calendarThumbJpegs?: string[];
  /** Carousel ZIP slides vs single 4:5 image post. Omitted in older saved rows → carousel. */
  scheduleKind?: ScheduleContentKind;
  /** Hook / headline for UI (carousel first slide or image-post hook). */
  displayHook?: string;
  /**
   * Phase 2.0 — Bunny.net public URLs for the assets needed to publish this
   * post. When set, the publish path can pass URLs directly to Meta instead
   * of fetching base64 from `.data/daemon-schedule.json` or in-memory state.
   */
  bunnyUrls?: BunnyAssetUrls;
  /** Posted automatically after publish; pin manually in IG/FB if desired. */
  firstComment?: string;
};

function loadFromStorage(): ScheduledCarouselPost[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is ScheduledCarouselPost =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as ScheduledCarouselPost).id === "string" &&
        typeof (x as ScheduledCarouselPost).queueItemId === "string" &&
        typeof (x as ScheduledCarouselPost).publishAtUnix === "number"
    );
  } catch {
    return [];
  }
}

function saveToStorage(items: ScheduledCarouselPost[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode */
  }
}

type ScheduleContextValue = {
  items: ScheduledCarouselPost[];
  addScheduled: (
    input: Omit<ScheduledCarouselPost, "id" | "createdAt">
  ) => ScheduledCarouselPost;
  /** Updates `publishAtUnix` for an existing row (re-sorts by time). */
  moveScheduled: (id: string, publishAtUnix: number) => void;
  /** Updates caption, destinations, and optional first comment. */
  updateScheduled: (
    id: string,
    patch: Partial<
      Pick<
        ScheduledCarouselPost,
        | "caption"
        | "postToInstagram"
        | "postToFacebook"
        | "postToYouTube"
        | "firstComment"
      >
    >
  ) => void;
  removeScheduled: (id: string) => void;
  /** Keeps calendar titles in sync when a queue row is renamed on Multiplier. */
  syncTitlesForQueueItem: (
    queueItemId: string,
    title: string | undefined,
    sourceFileName?: string
  ) => void;
  /** Push Bunny URLs from the home queue onto matching calendar rows + Hub. */
  syncBunnyUrlsForQueueItem: (
    queueItemId: string,
    bunnyUrls: BunnyAssetUrls
  ) => void;
  clearAll: () => void;
};

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ScheduledCarouselPost[]>([]);
  const [hydrated, setHydrated] = useState(false);
  /** Snapshot of the latest items used by fire-and-forget Hub sync handlers. */
  const itemsRef = useRef<ScheduledCarouselPost[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Phase 1 hydration:
  //   1. Show localStorage immediately (so the calendar isn't blank during the
  //      Hub fetch — important on slow connections, and as a fallback if the
  //      Hub call fails).
  //   2. Fire a Hub list call; on success, REPLACE local state with Hub data.
  //   3. One-time migration: push any localStorage rows the Hub doesn't know
  //      about into the Hub. After that, both stores agree and the user can
  //      switch devices without losing posts.
  useEffect(() => {
    const fromLocal = loadFromStorage();
    setItems(fromLocal);
    setHydrated(true);

    let cancelled = false;
    (async () => {
      const res = await listScheduledPostsFromHub();
      if (cancelled) return;
      if (!res.ok) {
        // Hub unreachable — stick with localStorage. Surface this in console
        // for now; a small UI banner can come in Phase 1.1 if desired.
        console.warn("[schedule] Hub list failed:", res.message);
        return;
      }
      const fromHub = res.data;
      const hubIds = new Set(fromHub.map((x) => x.id));
      // Replace state with the Hub set, then re-add any orphan local rows so
      // the user doesn't see them vanish if the Hub doesn't have them yet.
      const orphans = fromLocal.filter((x) => !hubIds.has(x.id));
      const merged = [...fromHub, ...orphans].sort(
        (a, b) => a.publishAtUnix - b.publishAtUnix
      );
      setItems(merged);
      // Fire-and-forget upsert for each orphan — Hub becomes the source of
      // truth from this session forward.
      for (const orphan of orphans) {
        upsertScheduledPostToHub(orphan).then((r) => {
          if (!r.ok) {
            console.warn(
              `[schedule] Hub upsert failed for orphan ${orphan.id}:`,
              r.message
            );
          }
        });
      }
    })().catch((e) => {
      console.warn("[schedule] Hub hydration crashed:", e);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep localStorage mirrored for the duration of Phase 1 so the existing
  // daemon-sync and offline behaviour stay intact. Once Phase 2 is fully out,
  // this can become read-only-fallback.
  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(items);
  }, [items, hydrated]);

  const addScheduled = useCallback(
    (input: Omit<ScheduledCarouselPost, "id" | "createdAt">) => {
      const row: ScheduledCarouselPost = {
        ...input,
        id: uuidv4(),
        createdAt: Date.now(),
      };
      setItems((prev) =>
        [...prev, row].sort((a, b) => a.publishAtUnix - b.publishAtUnix)
      );
      // Fire-and-forget Hub upsert. Local state already updated optimistically;
      // on failure we keep the row in localStorage and re-sync on next mount.
      upsertScheduledPostToHub(row).then((r) => {
        if (!r.ok) {
          console.warn("[schedule] Hub upsert (add) failed:", r.message);
        }
      });
      return row;
    },
    []
  );

  const moveScheduled = useCallback((id: string, publishAtUnix: number) => {
    setItems((prev) => {
      const next = prev
        .map((x) => (x.id === id ? { ...x, publishAtUnix } : x))
        .sort((a, b) => a.publishAtUnix - b.publishAtUnix);
      const moved = next.find((x) => x.id === id);
      if (moved) {
        upsertScheduledPostToHub(moved).then((r) => {
          if (!r.ok) {
            console.warn("[schedule] Hub upsert (move) failed:", r.message);
          }
        });
      }
      return next;
    });
  }, []);

  const updateScheduled = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          ScheduledCarouselPost,
          | "caption"
          | "postToInstagram"
          | "postToFacebook"
          | "postToYouTube"
          | "firstComment"
        >
      >
    ) => {
      setItems((prev) => {
        const next = prev.map((x) => {
          if (x.id !== id) return x;
          const updated = { ...x, ...patch };
          if (
            "firstComment" in patch &&
            (patch.firstComment === undefined || patch.firstComment === "")
          ) {
            delete updated.firstComment;
          }
          return updated;
        });
        const updated = next.find((x) => x.id === id);
        if (updated) {
          upsertScheduledPostToHub(updated).then((r) => {
            if (!r.ok) {
              console.warn("[schedule] Hub upsert (update) failed:", r.message);
            }
          });
        }
        return next;
      });
    },
    []
  );

  const removeScheduled = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    deleteScheduledPostFromHub(id).then((r) => {
      if (!r.ok && r.status !== 404) {
        console.warn("[schedule] Hub delete failed:", r.message);
      }
    });
  }, []);

  const syncTitlesForQueueItem = useCallback(
    (
      queueItemId: string,
      title: string | undefined,
      sourceFileName?: string
    ) => {
      const trimmed = title?.trim();
      setItems((prev) => {
        const affected: ScheduledCarouselPost[] = [];
        const next = prev.map((row) => {
          if (row.queueItemId !== queueItemId) return row;
          const updated: ScheduledCarouselPost = !trimmed
            ? {
                ...row,
                displayHook: undefined,
                videoLabel: sourceFileName ?? row.videoLabel,
              }
            : {
                ...row,
                videoLabel: trimmed,
                displayHook: trimmed,
              };
          affected.push(updated);
          return updated;
        });
        if (affected.length === 0) return prev;
        for (const row of affected) {
          upsertScheduledPostToHub(row).then((r) => {
            if (!r.ok) {
              console.warn("[schedule] Hub upsert (rename) failed:", r.message);
            }
          });
        }
        return next;
      });
    },
    []
  );

  const syncBunnyUrlsForQueueItem = useCallback(
    (queueItemId: string, bunnyUrls: BunnyAssetUrls) => {
      setItems((prev) => {
        let changed = false;
        const next = prev.map((row) => {
          if (row.queueItemId !== queueItemId) return row;
          const merged: BunnyAssetUrls = {
            ...(row.bunnyUrls ?? {}),
            ...bunnyUrls,
          };
          if (bunnyUrlsEqual(row.bunnyUrls, merged)) return row;
          changed = true;
          const updated = { ...row, bunnyUrls: merged };
          upsertScheduledPostToHub(updated).then((r) => {
            if (!r.ok) {
              console.warn(
                `[schedule] Hub upsert (bunny sync ${row.id}) failed:`,
                r.message,
              );
            }
          });
          return updated;
        });
        return changed ? next : prev;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    const snapshot = itemsRef.current;
    setItems([]);
    // Phase 1: clear localStorage state only; do NOT mass-delete on the Hub
    // (too easy to nuke things by accident). Manual UI for bulk delete can
    // come later.
    if (snapshot.length > 0) {
      console.warn(
        `[schedule] clearAll() cleared ${snapshot.length} local row(s); Hub rows preserved. Reload to re-hydrate from Hub.`
      );
    }
  }, []);

  const value = useMemo(
    () => ({
      items,
      addScheduled,
      moveScheduled,
      updateScheduled,
      removeScheduled,
      syncTitlesForQueueItem,
      syncBunnyUrlsForQueueItem,
      clearAll,
    }),
    [
      items,
      addScheduled,
      moveScheduled,
      updateScheduled,
      removeScheduled,
      syncTitlesForQueueItem,
      syncBunnyUrlsForQueueItem,
      clearAll,
    ]
  );

  return (
    <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>
  );
}

export function useScheduleStore(): ScheduleContextValue {
  const ctx = useContext(ScheduleContext);
  if (!ctx) {
    throw new Error("useScheduleStore must be used within ScheduleProvider");
  }
  return ctx;
}
