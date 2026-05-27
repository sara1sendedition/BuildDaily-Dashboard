export const DEFAULT_FIRST_COMMENT_STORAGE_KEY = "v2c-default-first-comment-v1";
/** Instagram / Facebook comment text limit (conservative cap for storage). */
export const MAX_DEFAULT_FIRST_COMMENT_CHARS = 2200;

export function getDefaultFirstCommentFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(DEFAULT_FIRST_COMMENT_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setDefaultFirstCommentToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_DEFAULT_FIRST_COMMENT_CHARS);
  try {
    localStorage.setItem(DEFAULT_FIRST_COMMENT_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
}

/** Same cap as storage — use when saving schedule rows or Hub payload fields. */
export function coerceFirstCommentField(
  raw: string | undefined | null
): string | undefined {
  const t = String(raw ?? "").trim();
  if (!t) return undefined;
  return t.slice(0, MAX_DEFAULT_FIRST_COMMENT_CHARS);
}
