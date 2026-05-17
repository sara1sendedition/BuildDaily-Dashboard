"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type { ScheduleContentKind } from "@/lib/schedule/calendar-preview-thumbs";

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
  removeScheduled: (id: string) => void;
  clearAll: () => void;
};

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ScheduledCarouselPost[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(loadFromStorage());
    setHydrated(true);
  }, []);

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
      return row;
    },
    []
  );

  const moveScheduled = useCallback((id: string, publishAtUnix: number) => {
    setItems((prev) => {
      const next = prev.map((x) =>
        x.id === id ? { ...x, publishAtUnix } : x
      );
      return next.sort((a, b) => a.publishAtUnix - b.publishAtUnix);
    });
  }, []);

  const removeScheduled = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({
      items,
      addScheduled,
      moveScheduled,
      removeScheduled,
      clearAll,
    }),
    [items, addScheduled, moveScheduled, removeScheduled, clearAll]
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
