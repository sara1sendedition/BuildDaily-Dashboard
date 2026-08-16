/**
 * Collapse duplicate Multiplier Hub rows that represent the same source video.
 * Stitch retries used to mint a new queue UUID while reusing the ProcessingJob,
 * which left two sidebar rows per clip after a tab restore.
 */

export type HubQueueDedupeItem = {
  id: string;
  status: string;
  videoLabel: string;
  createdAt?: string;
  payload?: {
    processingJobId?: string;
    driveFileId?: string;
    stitchJobId?: string;
    bunnyUrls?: { sourceVideoUrl?: string };
    sourceVideoUrl?: string;
  };
};

/** Filename stem, lowercased, without `_stitched` (IMG_6658.MOV == IMG_6658_stitched.mp4). */
export function normalizeQueueVideoStem(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutExt = trimmed.replace(/\.[^/.]+$/, "").trim() || trimmed;
  return withoutExt.replace(/_stitched$/i, "").trim() || withoutExt;
}

export function hubQueueDedupeKey(item: HubQueueDedupeItem): string | null {
  const payload = item.payload;
  const driveFileId = payload?.driveFileId?.trim();
  if (driveFileId) return `drive:${driveFileId}`;
  const stitchJobId = payload?.stitchJobId?.trim();
  if (stitchJobId) return `stitch:${stitchJobId}`;
  const sourceVideoUrl =
    payload?.bunnyUrls?.sourceVideoUrl?.trim() ||
    payload?.sourceVideoUrl?.trim();
  if (sourceVideoUrl) return `src:${sourceVideoUrl}`;
  const stem = normalizeQueueVideoStem(item.videoLabel);
  if (stem) return `name:${stem}`;
  return null;
}

function rankHubQueueItem(item: HubQueueDedupeItem): number {
  const payload = item.payload;
  let score = 0;
  if (item.status === "done") score += 80;
  else if (item.status === "processing") score += 20;
  if (payload?.processingJobId?.trim()) score += 40;
  if (
    payload?.driveFileId?.trim() ||
    payload?.stitchJobId?.trim() ||
    payload?.bunnyUrls?.sourceVideoUrl?.trim() ||
    payload?.sourceVideoUrl?.trim()
  ) {
    score += 10;
  }
  const created = item.createdAt ? Date.parse(item.createdAt) : 0;
  // Newer rows win ties (retry payload is usually richer).
  score += Number.isFinite(created) ? created / 1e15 : 0;
  return score;
}

/**
 * Keep one row per source video (or filename stem). Completed rows are never
 * dropped. Failed/processing clones of the same clip are extras.
 */
export function pickCanonicalHubQueueItems<T extends HubQueueDedupeItem>(
  items: T[],
): { keep: T[]; drop: T[] } {
  const groups = new Map<string, T[]>();
  const unique: T[] = [];
  for (const item of items) {
    const key = hubQueueDedupeKey(item);
    if (!key) {
      unique.push(item);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const keep: T[] = [...unique];
  const drop: T[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      keep.push(list[0]!);
      continue;
    }
    const done = list.filter((i) => i.status === "done");
    if (done.length > 0) {
      keep.push(...done);
      for (const extra of list) {
        if (extra.status !== "done") drop.push(extra);
      }
      continue;
    }
    const ranked = [...list].sort(
      (a, b) => rankHubQueueItem(b) - rankHubQueueItem(a),
    );
    const winner = ranked[0]!;
    keep.push(winner);
    for (const extra of ranked.slice(1)) drop.push(extra);
  }
  return { keep, drop };
}
