/**
 * Server-side config for proxying to the **Video to Short** FastAPI app (default port 8000).
 * @see Video to Short/backend/app/main.py
 */
export function getVideoToShortApiBaseUrl(): string {
  const raw = process.env.VIDEO_TO_SHORT_API_URL?.trim();
  const base = raw && raw.length > 0 ? raw : "http://127.0.0.1:8000";
  return base.replace(/\/$/, "");
}

export function isVideoToShortIntegrationEnabled(): boolean {
  const v = process.env.VIDEO_TO_SHORT_INTEGRATION?.trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}
