import { clientApiPath } from "@/lib/client-api-path";

/**
 * Same-origin preview URL that remuxes Bunny MP4s with faststart for iOS Safari.
 * Blob / same-origin / already-proxied URLs are returned unchanged.
 */
export function mobileFriendlyMp4PreviewUrl(url: string | null | undefined): string | null {
  const raw = url?.trim() ?? "";
  if (!raw) return null;
  if (raw.startsWith("blob:") || raw.startsWith("/")) return raw;
  if (raw.includes("/api/media/mp4-faststart")) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return raw;
    // Bunny CDN hosts (shared or custom pull zone).
    const host = u.hostname.toLowerCase();
    const looksBunny =
      host.endsWith(".b-cdn.net") ||
      host.includes("bunnycdn") ||
      host.endsWith("builddaily.app");
    if (!looksBunny) return raw;
  } catch {
    return raw;
  }
  return clientApiPath(
    `/api/media/mp4-faststart?url=${encodeURIComponent(raw)}`,
  );
}
