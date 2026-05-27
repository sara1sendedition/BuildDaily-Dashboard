/**
 * Hostnames we may fetch for `sourceVideoUrl` on /api/render (SSRF guard).
 * Override with BUNNY_SOURCE_VIDEO_FETCH_HOSTS (comma-separated) in env.
 */
const DEFAULT_ALLOWED_HOSTS = ["b-cdn.net", "storage.bunnycdn.com"];

function extraAllowedHosts(): string[] {
  const raw = process.env.BUNNY_SOURCE_VIDEO_FETCH_HOSTS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowed(hostname: string, allowed: string): boolean {
  const h = hostname.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

/** True when the URL is safe to fetch server-side (HTTPS Bunny CDN / configured hosts). */
export function isAllowedSourceVideoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hosts = [...DEFAULT_ALLOWED_HOSTS, ...extraAllowedHosts()];
  return hosts.some((allowed) => hostMatchesAllowed(parsed.hostname, allowed));
}
