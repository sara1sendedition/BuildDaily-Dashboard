/**
 * In-memory staging for multi-request publish (init → N parts → finalize).
 * Uses `globalThis` so the Map survives Next.js dev Fast Refresh (module reload).
 * Multi-instance hosts (e.g. many Vercel lambdas) still need one-shot multipart when
 * possible — see `postMetaCarouselPublish` trying a single POST before this path.
 */
export type PublishChunkSession = {
  slideCount: number;
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
  parts: (Buffer | null)[];
  received: number;
  expiresAt: number;
};

const STORE_KEY = "__videoStudioMetaPublishChunkSessions__";

function getStore(): Map<string, PublishChunkSession> {
  const g = globalThis as unknown as Record<string, Map<string, PublishChunkSession>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY]!;
}

const TTL_MS = 15 * 60 * 1000;

function sweepExpired() {
  const store = getStore();
  const now = Date.now();
  for (const [id, s] of store) {
    if (s.expiresAt < now) store.delete(id);
  }
}

export function createChunkSession(input: {
  slideCount: number;
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
}): string {
  const store = getStore();
  sweepExpired();
  const id = crypto.randomUUID();
  store.set(id, {
    slideCount: input.slideCount,
    caption: input.caption,
    publishInstagram: input.publishInstagram,
    publishFacebook: input.publishFacebook,
    scheduledPublishTime: input.scheduledPublishTime,
    parts: Array.from({ length: input.slideCount }, () => null),
    received: 0,
    expiresAt: Date.now() + TTL_MS,
  });
  return id;
}

export function addChunkSlide(
  sessionId: string,
  index: number,
  png: Buffer
):
  | { ok: true; received: number; total: number }
  | { ok: false; error: string } {
  const store = getStore();
  sweepExpired();
  const s = store.get(sessionId);
  if (!s) {
    return {
      ok: false,
      error:
        "Unknown or expired publish session. Try again. If this persists on production, the app may be hitting different servers for each step—publish from a single-node host or use fewer slides so one upload fits under the body limit.",
    };
  }
  if (Date.now() > s.expiresAt) {
    store.delete(sessionId);
    return { ok: false, error: "Session expired. Start publish again." };
  }
  if (!Number.isInteger(index) || index < 0 || index >= s.slideCount) {
    return { ok: false, error: "Invalid slide index." };
  }
  if (s.parts[index] !== null) {
    return { ok: false, error: "That slide index was already uploaded." };
  }
  s.parts[index] = png;
  s.received += 1;
  return { ok: true, received: s.received, total: s.slideCount };
}

/** Full publish payload when every part arrived; session stays until you call `deleteChunkSession` after Meta succeeds. */
export function getPublishPackIfReady(sessionId: string): {
  buffers: Buffer[];
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
} | null {
  const store = getStore();
  sweepExpired();
  const s = store.get(sessionId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    store.delete(sessionId);
    return null;
  }
  if (s.received !== s.slideCount) return null;
  if (s.parts.some((p) => p === null)) return null;
  return {
    buffers: s.parts as Buffer[],
    caption: s.caption,
    publishInstagram: s.publishInstagram,
    publishFacebook: s.publishFacebook,
    scheduledPublishTime: s.scheduledPublishTime,
  };
}

export function deleteChunkSession(sessionId: string) {
  getStore().delete(sessionId);
}
