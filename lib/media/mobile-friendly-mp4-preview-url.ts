import { clientApiPath } from "@/lib/client-api-path";

function hostMatchesDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** True when this HTTPS host is a Bunny / BuildDaily media CDN we can proxy. */
export function isBunnyMediaPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (hostMatchesDomain(host, "b-cdn.net")) return true;
  if (hostMatchesDomain(host, "storage.bunnycdn.com")) return true;
  // Custom pull zones only — not app/hub/api hosts (SSRF + wrong media).
  if (
    hostMatchesDomain(host, "builddaily.app") &&
    (host.startsWith("cdn.") ||
      host.startsWith("media.") ||
      host.startsWith("storage.") ||
      host.startsWith("vz-"))
  ) {
    return true;
  }
  return false;
}

/**
 * Same-origin preview URL that remuxes Bunny MP4s with faststart for iOS Safari.
 * Blob / same-origin / already-proxied URLs are returned unchanged.
 */
export function mobileFriendlyMp4PreviewUrl(
  url: string | null | undefined,
): string | null {
  const raw = url?.trim() ?? "";
  if (!raw) return null;
  if (raw.startsWith("blob:") || raw.startsWith("/")) return raw;
  if (raw.includes("/api/media/mp4-faststart")) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return raw;
    if (!isBunnyMediaPreviewHost(u.hostname)) return raw;
  } catch {
    return raw;
  }
  return clientApiPath(
    `/api/media/mp4-faststart?url=${encodeURIComponent(raw)}`,
  );
}
