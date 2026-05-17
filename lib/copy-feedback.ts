/** Max chars for optional “refine this output” notes sent with each generation. */
export const MAX_COPY_FEEDBACK_CHARS = 2000;

export const COPY_FEEDBACK_STORAGE_KEY = "v2i-copy-feedback-v1";

export function getCopyFeedbackFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(COPY_FEEDBACK_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setCopyFeedbackToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_COPY_FEEDBACK_CHARS);
  try {
    localStorage.setItem(COPY_FEEDBACK_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
}
