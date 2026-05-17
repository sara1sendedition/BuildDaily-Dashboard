/**
 * Local-storage persistence for the /stitch page's in-flight batch state.
 *
 * Why this exists: the stitch page used to upload each row, BLOCK on the
 * synchronous response, and lose all work when the browser disconnected
 * (lid close, mobile suspend, network drop). The new flow (`lib/run-stitch.ts`)
 * decouples upload from processing — the backend stitch endpoint is now
 * async-job based, so the server keeps stitching even after the client
 * disappears. To make that resilience visible to the user, we persist
 * enough state here that on tab reload we can:
 *   1. Recover the server-side jobId via `correlationId` (the client-side
 *      key persisted BEFORE upload — survives upload-response loss).
 *   2. Resume polling each not-yet-terminal row.
 *   3. Show "We saw N stitched videos from <time> — resume?" on reload.
 *
 * State is keyed under one localStorage key with a single batch at a time —
 * a new "Process" click overwrites the previous batch. TTL is 24h so stale
 * state doesn't haunt the UI forever.
 */

const LS_KEY = "stitch:batchState";
const TTL_MS = 24 * 60 * 60 * 1000;

export type StitchRowStatus =
  | "pending" // localStorage entry exists but upload hasn't started yet
  | "uploading" // multipart POST in flight
  | "processing" // upload accepted, server-side ffmpeg concat running
  | "completed" // server marked done; output downloaded by the client
  | "failed";

export type StitchRowState = {
  /** UI row index (1-based-ish — matches "Video N" label). */
  rowIndex: number;
  /** Stable client-generated id; sent to the server as ``client_correlation_id``.
   *  Lets the client recover the server-side jobId after upload-response loss. */
  correlationId: string;
  /** Server-side job id, set after the upload response comes back. Until then,
   *  the only way to find the job server-side is via correlationId lookup. */
  jobId: string | null;
  status: StitchRowStatus;
  /** Free-text per-row instructions, mirrored from the UI so the recovery
   *  hand-off to the home page carries them. */
  aiInstructions?: string;
  /** Suggested download filename (`<stem>_stitched.mp4`). */
  outputFilename: string;
  /** Last error message if status === "failed". */
  error?: string;
  /** Filenames of the input clips, ONLY for surfacing in the recovery UI —
   *  we can't reconstruct File objects from these. */
  clipNames: string[];
};

export type StitchBatchState = {
  /** Random per-batch id so the recovery UI can dedupe across reloads. */
  batchId: string;
  /** ms-since-epoch when the batch was created (used for TTL + "from <time>"). */
  createdAt: number;
  rows: StitchRowState[];
};

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Cryptographically-strong UUID with a `Math.random` fallback. Uniqueness floor
 *  here is "no collisions between two quick clicks" — not security. */
export function generateStitchId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readStitchBatch(): StitchBatchState | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  let raw: string | null;
  try {
    raw = ls.getItem(LS_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: Partial<StitchBatchState>;
  try {
    parsed = JSON.parse(raw) as Partial<StitchBatchState>;
  } catch {
    return null;
  }
  if (
    typeof parsed.batchId !== "string" ||
    typeof parsed.createdAt !== "number" ||
    !Array.isArray(parsed.rows)
  ) {
    return null;
  }
  if (Date.now() - parsed.createdAt > TTL_MS) {
    clearStitchBatch();
    return null;
  }
  // Light shape check on rows so a corrupted entry can't crash the page.
  const rows: StitchRowState[] = [];
  for (const r of parsed.rows) {
    if (
      r &&
      typeof r === "object" &&
      typeof (r as StitchRowState).correlationId === "string" &&
      typeof (r as StitchRowState).status === "string"
    ) {
      rows.push(r as StitchRowState);
    }
  }
  return { batchId: parsed.batchId, createdAt: parsed.createdAt, rows };
}

export function writeStitchBatch(state: StitchBatchState): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* quota / disabled — ignore */
  }
}

/** Merge a partial update into the row at ``rowIndex``. No-op if no batch
 *  is currently persisted, or if the row index is out of range. */
export function patchStitchRow(
  rowIndex: number,
  patch: Partial<StitchRowState>
): StitchBatchState | null {
  const cur = readStitchBatch();
  if (!cur) return null;
  const idx = cur.rows.findIndex((r) => r.rowIndex === rowIndex);
  if (idx < 0) return cur;
  const next = {
    ...cur,
    rows: cur.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
  };
  writeStitchBatch(next);
  return next;
}

export function clearStitchBatch(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** True when at least one row hasn't reached a terminal state — i.e. there's
 *  work the client should resume polling rather than declare done. */
export function hasIncompleteRows(state: StitchBatchState | null): boolean {
  if (!state) return false;
  return state.rows.some(
    (r) => r.status !== "completed" && r.status !== "failed"
  );
}

/** "5 minutes ago" / "an hour ago" / "yesterday" — used in the recovery
 *  banner. Kept dependency-free; the page's recovery UX doesn't need
 *  Intl.RelativeTimeFormat correctness for the few timescales we care about. */
export function describeAgeMs(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 2) return "a minute ago";
  if (min < 60) return `${min} minutes ago`;
  const hr = Math.round(min / 60);
  if (hr < 2) return "an hour ago";
  if (hr < 24) return `${hr} hours ago`;
  const d = Math.round(hr / 24);
  if (d < 2) return "a day ago";
  return `${d} days ago`;
}
