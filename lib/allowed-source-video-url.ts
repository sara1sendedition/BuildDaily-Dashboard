/**
 * Hostnames we may fetch for `sourceVideoUrl` / mp4-faststart (SSRF guard).
 * Override with BUNNY_SOURCE_VIDEO_FETCH_HOSTS (comma-separated) in env.
 *
 * Includes `builddaily.app` so custom Bunny pull zones like `cdn.builddaily.app`
 * match the same hosts the client preview helper already treats as Bunny CDN.
 */
const DEFAULT_ALLOWED_HOSTS = [
  "b-cdn.net",
  "storage.bunnycdn.com",
  "builddaily.app",
];

function hostnameFromEnv(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase();
  }
}

function configuredBunnyPullHosts(): string[] {
  return [
    hostnameFromEnv(process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME),
    hostnameFromEnv(process.env.BUNNY_STREAM_PULL_ZONE_HOSTNAME),
  ].filter((h): h is string => Boolean(h));
}

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
  const hosts = [
    ...DEFAULT_ALLOWED_HOSTS,
    ...configuredBunnyPullHosts(),
    ...extraAllowedHosts(),
  ];
  return hosts.some((allowed) => hostMatchesAllowed(parsed.hostname, allowed));
}
