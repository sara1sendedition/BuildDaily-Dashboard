/**
 * Home-page "Editorial notes for AI" (Video to Short smart editorial).
 * Must persist to localStorage so the queue processor can read the same text
 * the user typed before upload — the processor runs outside the React tree.
 */

import { MAX_CAROUSEL_FOCUS_CHARS } from "@/lib/carousel-focus";

export const SHORT_EDITORIAL_NOTES_STORAGE_KEY = "v2c-short-editorial-notes-v1";

export function getShortEditorialNotesFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(SHORT_EDITORIAL_NOTES_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setShortEditorialNotesToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_CAROUSEL_FOCUS_CHARS);
  try {
    localStorage.setItem(SHORT_EDITORIAL_NOTES_STORAGE_KEY, trimmed);
  } catch {
    /* quota / private mode */
  }
}
