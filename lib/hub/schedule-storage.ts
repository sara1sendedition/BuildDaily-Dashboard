/** Shared with schedule-context — keep in sync. */
export const SCHEDULE_STORAGE_KEY = "video-studio-scheduled-carousels-v1";

export type ScheduledRow = {
  id: string;
  publishAtUnix: number;
  daemonPublishedAt?: number;
};

export function readScheduledPostsFromStorage(): ScheduledRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is { id: string; publishAtUnix: number } =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as { id?: string }).id === "string" &&
          typeof (x as { publishAtUnix?: number }).publishAtUnix === "number"
      )
      .map((x) => ({ id: x.id, publishAtUnix: x.publishAtUnix }));
  } catch {
    return [];
  }
}

export function countUpcomingScheduled(nowUnix = Math.floor(Date.now() / 1000)): number {
  return readScheduledPostsFromStorage().filter((p) => p.publishAtUnix > nowUnix)
    .length;
}

export function nextScheduledPublishAt(
  nowUnix = Math.floor(Date.now() / 1000)
): number | null {
  const upcoming = readScheduledPostsFromStorage()
    .filter((p) => p.publishAtUnix > nowUnix)
    .map((p) => p.publishAtUnix)
    .sort((a, b) => a - b);
  return upcoming[0] ?? null;
}
