/**
 * Optional per-run notes for the AI (main studio + style-carousel).
 * Stored in the browser; sent as `carouselFocus` with `/api/process` (and style-carousel),
 * merged into copy context for image post + X/Threads. For Video to Short `editorial_notes`
 * on the **first** queue run, see `lib/short-editorial-notes-storage.ts` (home "Editorial notes
 * for AI") and this key for studio run notes when no other brief is present.
 */

import { MAX_COPY_CONTEXT_CHARS } from "@/lib/copy-context";

export const CAROUSEL_FOCUS_STORAGE_KEY = "v2c-carousel-focus-v1";
export const MAX_CAROUSEL_FOCUS_CHARS = 4000;

export function getCarouselFocusFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(CAROUSEL_FOCUS_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setCarouselFocusToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_CAROUSEL_FOCUS_CHARS);
  try {
    localStorage.setItem(CAROUSEL_FOCUS_STORAGE_KEY, trimmed);
  } catch {
    // quota / private mode
  }
}

/** Appends home “studio run notes” to merged Settings copy for image-post + social APIs. */
export function mergeCopyContextWithStudioRunNotes(
  mergedCopyContext: string | undefined
): string | undefined {
  const notes = getCarouselFocusFromStorage().trim();
  if (!notes) {
    const b = mergedCopyContext?.trim();
    return b ? mergedCopyContext!.trim() : undefined;
  }
  const block = `--- Studio run notes (from home; per-format angles you care about) ---\n${notes}`;
  const base = (mergedCopyContext ?? "").trim();
  const combined = base ? `${base}\n\n${block}` : block;
  const trimmed = combined.slice(0, MAX_COPY_CONTEXT_CHARS);
  return trimmed.length > 0 ? trimmed : undefined;
}
