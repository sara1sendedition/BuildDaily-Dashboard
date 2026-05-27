/** Parse scheduled time from JSON (number, unix string, or date string). */
export function parseScheduledField(
  raw: number | string | undefined
): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string") {
    const t = raw.trim();
    if (/^\d{9,12}$/.test(t)) {
      const unix = parseInt(t, 10);
      if (Number.isFinite(unix) && unix > 0) return unix;
    }
  }
  const d = new Date(String(raw));
  const sec = Math.floor(d.getTime() / 1000);
  return Number.isFinite(sec) && sec > 0 ? sec : undefined;
}

/**
 * Returns the scheduled time only if it's far enough in the future to be a
 * real native-schedule request. A time in the past (or within `skewSec`)
 * means "publish now" — callers should drop it so it isn't forwarded to the
 * platform (Instagram rejects any scheduled_publish_time unless allowlisted,
 * and YouTube rejects a past publishAt). Mirrors /api/schedule/publish-now.
 */
export function futureScheduledOrUndefined(
  raw: number | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
  skewSec: number = 600
): number | undefined {
  return raw != null && Number.isFinite(raw) && raw > nowSec + skewSec
    ? raw
    : undefined;
}
