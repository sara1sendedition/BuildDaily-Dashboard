/**
 * Limits for POST /api/integrations/meta/publish.
 *
 * The app sends **multipart/form-data** with binary PNGs (~33% smaller than JSON+base64).
 * The server re-encodes to JPEG (quality 0.89 on a 0–1 scale → encoder 89/100) for Meta upload;
 * per-slide bytes are often smaller than the incoming PNG for typical flat slides.
 * JSON+base64 is still accepted for API clients.
 *
 * **Rough slide counts:** under the same byte cap you fit more slides than with base64 JSON;
 * chunked 2+ slide flow sends one PNG per part (JPEG only on finalize to Meta).
 *
 * | Environment | Default cap | Typical full-size slides (multipart) |
 * |------------|-------------|----------------------------------------|
 * | Vercel (`VERCEL=1`) | ~4.5MB (Hobby platform) | Often **2–4** |
 * | Local / self-hosted | 50MB | Often **~15–35** |
 *
 * Set `META_PUBLISH_MAX_BODY_BYTES` (integer bytes) to override.
 */

export function getMaxPublishBodyBytes(): number {
  const raw = process.env.META_PUBLISH_MAX_BODY_BYTES?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(n, 200 * 1024 * 1024);
    }
  }
  if (process.env.VERCEL) return 4_500_000;
  return 50_000_000;
}

export function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** One-line hint for the schedule dialog (server-generated so it matches the active cap). */
/** Max multipart body for POST /api/integrations/meta/publish-reel (MP4). */
export function getMaxReelUploadBytes(): number {
  const raw = process.env.META_REEL_MAX_BODY_BYTES?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(n, 1024 * 1024 * 1024);
    }
  }
  if (process.env.VERCEL) return 90 * 1024 * 1024;
  return 500 * 1024 * 1024;
}

export function formatPublishLimitSummary(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  let typical = "about 2–5";
  if (maxBytes >= 45_000_000) typical = "on the order of 15–45";
  else if (maxBytes >= 20_000_000) typical = "roughly 10–25";
  else if (maxBytes >= 10_000_000) typical = "roughly 5–12";
  return `Per-request upload limit ~${rounded}MB. With 2+ slides the app sends one slide per request, then one finalize—each hop counts against this cap, not the whole carousel at once. Set META_PUBLISH_MAX_BODY_BYTES to change it.`;
}
