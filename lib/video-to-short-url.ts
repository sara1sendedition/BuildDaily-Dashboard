/**
 * Base URL for the separate **Video to Short** app (raw video → edited / publishable short).
 * Set `NEXT_PUBLIC_VIDEO_TO_SHORT_URL` in `.env.local` (no trailing slash). Example:
 * `http://localhost:5173` for Vite dev, or your deployed URL in production.
 */
export function getVideoToShortUrl(): string {
  const raw = process.env.NEXT_PUBLIC_VIDEO_TO_SHORT_URL?.trim();
  if (raw && raw.length > 0) {
    return raw.replace(/\/$/, "");
  }
  return "http://localhost:5173";
}
