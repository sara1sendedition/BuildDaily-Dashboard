/**
 * Tiny IndexedDB helper that lets the /stitch page hand a stitched MP4 to
 * the home page across a route change. We can't pass a File via URL, and
 * sessionStorage caps at ~5 MB which won't fit a video. IndexedDB handles
 * Blob storage natively and persists across navigations.
 *
 * Original v1 design used `consumeStitchedFile` (read+delete in one tx). That
 * was fragile on mobile: if the home page failed to fully kick off processing
 * (network blip, tab suspended mid-fetch, JS error), the file was gone with
 * no retry path. v2 splits this into `peekStitchedFile` (read only) and
 * `clearStitchedFile` (explicit delete). The home page peeks on mount and
 * clears only after the queue item lands in a terminal success state.
 */

const DB_NAME = "stitch-handoff";
const DB_VERSION = 1;
const STORE = "files";
const KEY = "pending";

type StashedFile = {
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
  aiInstructions?: string;
};

type StashedBatch = {
  entries: StashedFile[];
  createdAt: number;
};

export type PeekedStitchedFile = {
  file: File;
  /** ms-since-epoch when the file was stashed; useful to dedupe on refresh. */
  createdAt: number;
};

export type PeekedStitchedFiles = {
  files: File[];
  aiInstructionsByFile: Array<string | undefined>;
  /** ms-since-epoch when this batch was stashed; useful to dedupe on refresh. */
  createdAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function stashStitchedFiles(
  files: Array<{ blob: Blob; name?: string; aiInstructions?: string }>
): Promise<void> {
  const valid = files.filter((f) => f.blob && f.blob.size > 0);
  if (valid.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const now = Date.now();
    const entries: StashedFile[] = valid.map((f, idx) => ({
      blob: f.blob,
      name: f.name?.trim() || `stitched_${idx + 1}.mp4`,
      type: f.blob.type || "video/mp4",
      createdAt: now,
      aiInstructions:
        typeof f.aiInstructions === "string" && f.aiInstructions.trim()
          ? f.aiInstructions.trim()
          : undefined,
    }));
    const value: StashedBatch = {
      entries,
      createdAt: now,
    };
    const req = store.put(value, KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB put failed"));
  });
  db.close();
}

export async function stashStitchedFile(
  blob: Blob,
  name = "stitched.mp4"
): Promise<void> {
  await stashStitchedFiles([{ blob, name }]);
}

/**
 * Read the stashed file WITHOUT removing it. Returns null when nothing's
 * pending or when the entry is stale (> 24 hours old). Stale entries are
 * proactively cleared so they don't keep coming back.
 */
export async function peekStitchedFiles(): Promise<PeekedStitchedFiles | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  const value = await new Promise<StashedBatch | StashedFile | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const getReq = store.get(KEY);
      getReq.onsuccess = () =>
        resolve(getReq.result as StashedBatch | StashedFile | undefined);
      getReq.onerror = () => reject(getReq.error ?? new Error("IDB get failed"));
    }
  );
  db.close();
  if (!value) return null;

  const isBatch = (v: unknown): v is StashedBatch =>
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as StashedBatch).entries) &&
    typeof (v as StashedBatch).createdAt === "number";

  let entries: StashedFile[];
  let createdAt: number;
  if (isBatch(value)) {
    entries = value.entries;
    createdAt = value.createdAt;
  } else {
    // Backward compatibility with v1 single-file record shape.
    const single = value as StashedFile;
    entries = [single];
    createdAt = single.createdAt;
  }

  if (Date.now() - createdAt > 24 * 60 * 60 * 1000) {
    await clearStitchedFile().catch(() => undefined);
    return null;
  }

  const files: File[] = [];
  const aiInstructionsByFile: Array<string | undefined> = [];
  for (const entry of entries) {
    try {
      files.push(new File([entry.blob], entry.name, { type: entry.type }));
      aiInstructionsByFile.push(
        typeof entry.aiInstructions === "string" && entry.aiInstructions.trim()
          ? entry.aiInstructions.trim()
          : undefined
      );
    } catch {
      // Skip malformed entry and continue.
    }
  }

  if (files.length === 0) return null;
  return { files, aiInstructionsByFile, createdAt };
}

export async function peekStitchedFile(): Promise<PeekedStitchedFile | null> {
  const peeked = await peekStitchedFiles();
  if (!peeked || peeked.files.length === 0) return null;
  return { file: peeked.files[0], createdAt: peeked.createdAt };
}

/**
 * Explicitly remove the stashed file. Call this after the queue item that
 * was created from the stitched file reaches a terminal success state.
 */
export async function clearStitchedFile(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
  });
  db.close();
}

/**
 * @deprecated v1 read-and-delete behavior. Prefer
 *   const { file } = (await peekStitchedFile()) ?? {};
 *   // ... use file ...
 *   // after success: await clearStitchedFile();
 *
 * Kept as a thin alias so existing callers don't break during the rollout.
 */
export async function consumeStitchedFile(): Promise<File | null> {
  const peeked = await peekStitchedFile();
  if (!peeked) return null;
  await clearStitchedFile().catch(() => undefined);
  return peeked.file;
}
