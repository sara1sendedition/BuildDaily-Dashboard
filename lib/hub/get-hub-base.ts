/**
 * Resolve the BuildDaily Hub API origin for `/api/hub/*` proxy routes.
 *
 * - ContentMultiplier (app.builddaily.app): set `HUB_API_URL=https://hub.builddaily.app`
 * - BuildDaily Dashboard when it IS the hub: same var, or `NEXT_PUBLIC_SITE_URL`
 */
export function getHubBase(): string | null {
  const raw = process.env.HUB_API_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  return site ? site.replace(/\/$/, "") : null;
}

export function requireHubBase(): string {
  const base = getHubBase();
  if (!base) {
    throw new Error(
      "HUB_API_URL is not set. Add it to Coolify env (e.g. https://hub.builddaily.app).",
    );
  }
  return base;
}
