/**
 * Helpers for consuming a stitch IndexedDB handoff into the shared video queue
 * without false "already consumed" skips or clearing IDB too early.
 */

export const STITCH_ENQUEUED_AT_KEY = "stitch:enqueuedCreatedAt";
const CLAIMING_SENTINEL = "__claiming__";

/** In-memory lock for the current page lifetime (StrictMode-safe). */
let stitchEnqueueLockCreatedAt: number | null = null;

export function stitchEnqueuedIdsKey(createdAt: number): string {
  return `stitch:enqueuedIds:${createdAt}`;
}

export function readStitchEnqueuedIds(createdAt: number): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(stitchEnqueuedIdsKey(createdAt));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Real queue IDs only — strips the in-flight claim sentinel. */
export function readStitchHandoffQueueIds(createdAt: number): string[] {
  return readStitchEnqueuedIds(createdAt).filter((id) => id !== CLAIMING_SENTINEL);
}

export function writeStitchEnqueuedIds(
  createdAt: number,
  ids: string[]
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      stitchEnqueuedIdsKey(createdAt),
      JSON.stringify(ids)
    );
    window.sessionStorage.setItem(STITCH_ENQUEUED_AT_KEY, String(createdAt));
  } catch {
    /* ignore */
  }
  if (ids.length > 0 && !isClaimingSentinel(ids)) {
    stitchEnqueueLockCreatedAt = null;
  }
}

/**
 * Atomically claim a stash before enqueueing. Returns false if this createdAt
 * is already claimed in this page lifetime, or already has real queue IDs
 * (unless `allowRetry` for partial/failed recovery).
 */
export function claimStitchEnqueue(
  createdAt: number,
  opts?: { allowRetry?: boolean }
): boolean {
  if (stitchEnqueueLockCreatedAt === createdAt) return false;
  const existing = readStitchEnqueuedCreatedAt();
  if (existing === String(createdAt)) {
    const ids = readStitchEnqueuedIds(createdAt);
    if (ids.length > 0 && !isClaimingSentinel(ids) && !opts?.allowRetry) {
      return false;
    }
  }
  stitchEnqueueLockCreatedAt = createdAt;
  if (!opts?.allowRetry) {
    writeStitchEnqueuedIds(createdAt, [CLAIMING_SENTINEL]);
    stitchEnqueueLockCreatedAt = createdAt;
  }
  return true;
}

/**
 * Release an in-flight claim when the consumer effect is cancelled before
 * enqueue completes (route change / StrictMode). Leaves real queue IDs intact.
 */
export function releaseStitchEnqueueClaimIfStillClaiming(
  createdAt: number
): void {
  if (stitchEnqueueLockCreatedAt === createdAt) {
    stitchEnqueueLockCreatedAt = null;
  }
  const ids = readStitchEnqueuedIds(createdAt);
  if (!isClaimingSentinel(ids)) return;
  try {
    window.sessionStorage.removeItem(stitchEnqueuedIdsKey(createdAt));
    if (readStitchEnqueuedCreatedAt() === String(createdAt)) {
      window.sessionStorage.removeItem(STITCH_ENQUEUED_AT_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readStitchEnqueuedCreatedAt(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(STITCH_ENQUEUED_AT_KEY) ?? "";
  } catch {
    return "";
  }
}

type QueueRowLike = {
  id: string;
  status: string;
  file: { size: number };
  error?: string;
};

function isClaimingSentinel(ids: string[]): boolean {
  return ids.length === 1 && ids[0] === CLAIMING_SENTINEL;
}

function isRetryableHandoffRow(item: QueueRowLike): boolean {
  if (item.status === "done") return false;
  if (
    (item.status === "pending" || item.status === "processing") &&
    item.file.size > 0
  ) {
    return false;
  }
  // error (any size), interrupted zero-byte stubs, or other non-done states
  return true;
}

/**
 * Indexes into the stashed file list that still need enqueueing.
 * `null` means enqueue the full batch (first run / no tracked IDs).
 * Empty array means nothing to enqueue (skip).
 */
export function stitchHandoffRetryFileIndexes(
  queue: QueueRowLike[],
  createdAt: number
): number[] | null {
  const ids = readStitchHandoffQueueIds(createdAt);
  if (ids.length === 0) return null;
  const indexes: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const item = queue.find((q) => q.id === ids[i]);
    if (!item) {
      indexes.push(i);
      continue;
    }
    if (isRetryableHandoffRow(item)) {
      indexes.push(i);
    }
  }
  return indexes;
}

/**
 * True when this stash was already enqueued and we should not enqueue again.
 */
export function stitchHandoffShouldSkipReenqueue(
  queue: QueueRowLike[],
  createdAt: number,
  hubQueueHydrationDone: boolean
): boolean {
  const ids = readStitchEnqueuedIds(createdAt);
  if (ids.length === 0) return false;
  if (isClaimingSentinel(ids)) {
    return stitchEnqueueLockCreatedAt === createdAt;
  }

  const handoffItems = queue.filter((q) => ids.includes(q.id));
  if (handoffItems.length === 0) {
    return !hubQueueHydrationDone;
  }

  if (
    handoffItems.length === ids.length &&
    handoffItems.every((q) => q.status === "done")
  ) {
    return true;
  }

  if (
    handoffItems.some(
      (q) =>
        (q.status === "pending" || q.status === "processing") && q.file.size > 0
    )
  ) {
    return true;
  }

  const retryIndexes = stitchHandoffRetryFileIndexes(queue, createdAt);
  if (retryIndexes && retryIndexes.length > 0) {
    return false;
  }

  return true;
}

/**
 * Remove handoff rows that will be re-enqueued (failed / interrupted stubs).
 * No-ops when there are no tracked real IDs yet.
 */
export function removeRetryableHandoffRows(
  queue: QueueRowLike[],
  createdAt: number,
  removeQueueItem: (id: string) => void
): void {
  const ids = readStitchHandoffQueueIds(createdAt);
  if (ids.length === 0) return;
  for (const id of ids) {
    const item = queue.find((q) => q.id === id);
    if (item && isRetryableHandoffRow(item)) {
      removeQueueItem(item.id);
    }
  }
}

/**
 * Clear IndexedDB only when every tracked handoff queue row reached `done`.
 * Failures leave the stash so refresh can retry.
 */
export function stitchHandoffBatchFullyDone(
  queue: QueueRowLike[],
  handoffQueueIds: string[]
): boolean {
  const ids = handoffQueueIds.filter((id) => id !== CLAIMING_SENTINEL);
  if (ids.length === 0) return false;
  const items = ids
    .map((id) => queue.find((q) => q.id === id))
    .filter((q): q is QueueRowLike => Boolean(q));
  if (items.length !== ids.length) return false;
  return items.every((q) => q.status === "done");
}

/**
 * Merge newly enqueued IDs back into the session map by file index, keeping
 * any already-done handoff row IDs in place.
 */
export function mergeStitchHandoffQueueIds(
  createdAt: number,
  fileCount: number,
  retryIndexes: number[] | null,
  newIds: string[]
): string[] {
  const prev = readStitchHandoffQueueIds(createdAt);
  if (retryIndexes === null) {
    writeStitchEnqueuedIds(createdAt, newIds);
    return newIds;
  }
  const next = Array.from({ length: fileCount }, (_, i) => prev[i] ?? "");
  retryIndexes.forEach((fileIndex, j) => {
    const id = newIds[j];
    if (typeof id === "string") next[fileIndex] = id;
  });
  const merged = next.filter((id) => id.length > 0);
  writeStitchEnqueuedIds(createdAt, merged);
  return merged;
}
