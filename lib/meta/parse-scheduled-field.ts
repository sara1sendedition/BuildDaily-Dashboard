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
