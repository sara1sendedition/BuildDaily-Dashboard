/** Client-side persistence for copywriting context sent with each /api/process run. */

export const COPY_CONTEXT_STORAGE_KEY = "v2c-copy-context-v1";
export const MAX_COPY_CONTEXT_CHARS = 12000;

export function getCopyContextFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(COPY_CONTEXT_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setCopyContextToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_COPY_CONTEXT_CHARS);
  try {
    localStorage.setItem(COPY_CONTEXT_STORAGE_KEY, trimmed);
  } catch {
    // quota / private mode
  }
}

export function clearCopyContextStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(COPY_CONTEXT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
