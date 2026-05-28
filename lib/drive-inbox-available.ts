import { clientApiPath } from "@/lib/client-api-path";

/** Whether the Video to Short backend has a usable Drive inbox (health or inbox list). */
export async function fetchDriveInboxConfigured(): Promise<boolean> {
  let healthConfigured = false;
  try {
    const health = await fetch(clientApiPath("/api/video-to-short/health"), {
      cache: "no-store",
    });
    if (health.status === 404) return false;
    if (health.ok) {
      const h = (await health.json()) as { drive_inbox_configured?: boolean };
      healthConfigured = Boolean(h.drive_inbox_configured);
      if (healthConfigured) return true;
    }
  } catch {
    /* fall through to inbox probe */
  }

  try {
    const r = await fetch(clientApiPath("/api/video-to-short/drive/inbox"), {
      cache: "no-store",
    });
    if (r.status === 404) return false;
    if (!r.ok) return healthConfigured;
    const data = (await r.json()) as { configured?: boolean };
    return Boolean(data.configured) || healthConfigured;
  } catch {
    return healthConfigured;
  }
}
