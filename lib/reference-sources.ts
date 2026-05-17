/** User-provided excerpts / notes from trusted climbing sources  -  sent with each generation. */

export const REFERENCE_SOURCES_STORAGE_KEY = "v2i-reference-sources-v1";
/** Enough for several pasted articles or cue sheets (stay under model context). */
export const MAX_REFERENCE_SOURCES_CHARS = 24000;

export function getReferenceSourcesFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(REFERENCE_SOURCES_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setReferenceSourcesToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_REFERENCE_SOURCES_CHARS);
  try {
    localStorage.setItem(REFERENCE_SOURCES_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
}
