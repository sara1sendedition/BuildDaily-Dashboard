/** Plan for turning a Drive batch into stitch rows (multi-clip vs solo). */

export const MAX_STITCH_AUTO_GROUP_FILES = 40;
export const MAX_STITCH_GROUP_TRANSCRIPT_CHARS = 1800;
/** Consecutive clips closer than this are likely one take split across files. */
export const STITCH_HEURISTIC_GAP_MS = 8 * 60 * 1000;
export const STITCH_HEURISTIC_SEQ_GAP_MS = 15 * 60 * 1000;
export const STITCH_HEURISTIC_MAX_GROUP = 6;

export type StitchGroupKind = "stitch" | "solo";

export type StitchGroupClipInput = {
  fileId: string;
  name: string;
  modifiedAt: string | null;
  durationSec: number | null;
  text: string;
};

export type StitchGroup = {
  fileIds: string[];
  kind: StitchGroupKind;
  reason: string;
};

export function transcriptPlainText(
  segments: Array<{ text?: string }> | null | undefined
): string {
  if (!segments?.length) return "";
  return segments
    .map((s) => (typeof s.text === "string" ? s.text.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep head + tail so grouping can see both the opening and whether the take trails off. */
export function excerptTranscript(
  text: string,
  maxChars = MAX_STITCH_GROUP_TRANSCRIPT_CHARS
): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  const ellipsis = "…";
  const budget = Math.max(20, maxChars - ellipsis.length);
  const head = Math.max(1, Math.floor(budget * 0.65));
  const tail = Math.max(1, budget - head);
  return `${t.slice(0, head).trimEnd()}${ellipsis}${t.slice(-tail).trimStart()}`;
}

function kindFromIds(fileIds: string[]): StitchGroupKind {
  return fileIds.length >= 2 ? "stitch" : "solo";
}

function asFileIdList(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Normalize an LLM (or heuristic) grouping so every input id appears exactly once.
 * Unknown ids are dropped; leftover ids become solo groups at the end.
 */
export function parseStitchGroupPlan(
  raw: unknown,
  fileIds: string[]
): StitchGroup[] {
  const allowed = new Set(fileIds.filter((id) => id.trim().length > 0));
  const orderedIds = fileIds.filter((id) => allowed.has(id));
  if (orderedIds.length === 0) return [];

  const used = new Set<string>();
  const groups: StitchGroup[] = [];

  const rawGroups =
    raw && typeof raw === "object" && raw !== null && "groups" in raw
      ? (raw as { groups?: unknown }).groups
      : Array.isArray(raw)
        ? raw
        : null;

  if (Array.isArray(rawGroups)) {
    for (const item of rawGroups) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      const ids = asFileIdList(o.fileIds ?? o.file_ids ?? o.ids, allowed).filter(
        (id) => !used.has(id)
      );
      if (ids.length === 0) continue;
      for (const id of ids) used.add(id);
      const reason =
        typeof o.reason === "string" && o.reason.trim()
          ? o.reason.trim().slice(0, 240)
          : ids.length >= 2
            ? "Same take continued across clips."
            : "Standalone clip.";
      groups.push({ fileIds: ids, kind: kindFromIds(ids), reason });
    }
  }

  for (const id of orderedIds) {
    if (used.has(id)) continue;
    groups.push({
      fileIds: [id],
      kind: "solo",
      reason: "Not grouped — queued on its own.",
    });
  }

  return groups;
}

function cameraSequence(name: string): { prefix: string; n: number } | null {
  const stem = name.replace(/\.[^/.]+$/i, "").trim();
  const m = stem.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1]!.toLowerCase(), n: Number(m[2]) };
}

function modifiedMs(clip: StitchGroupClipInput): number | null {
  if (!clip.modifiedAt) return null;
  const t = Date.parse(clip.modifiedAt);
  return Number.isFinite(t) ? t : null;
}

function sortClipsForHeuristic(
  clips: StitchGroupClipInput[]
): StitchGroupClipInput[] {
  return [...clips].sort((a, b) => {
    const am = modifiedMs(a);
    const bm = modifiedMs(b);
    if (am != null && bm != null && am !== bm) return am - bm;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

function shouldJoinHeuristic(
  prev: StitchGroupClipInput,
  next: StitchGroupClipInput
): boolean {
  const prevMs = modifiedMs(prev);
  const nextMs = modifiedMs(next);
  const gap =
    prevMs != null && nextMs != null ? Math.abs(nextMs - prevMs) : null;

  const a = cameraSequence(prev.name);
  const b = cameraSequence(next.name);
  const sequential =
    a != null && b != null && a.prefix === b.prefix && Math.abs(b.n - a.n) === 1;

  if (sequential && (gap == null || gap <= STITCH_HEURISTIC_SEQ_GAP_MS)) {
    return true;
  }
  if (gap != null && gap <= STITCH_HEURISTIC_GAP_MS) {
    return true;
  }
  return false;
}

/**
 * Time + filename fallback when the LLM is stubbed or its JSON is unusable.
 * Consecutive clips recorded close together (or IMG_1234 / IMG_1235) form a stitch group.
 */
export function heuristicStitchGroups(
  clips: StitchGroupClipInput[]
): StitchGroup[] {
  if (clips.length === 0) return [];
  const sorted = sortClipsForHeuristic(clips);
  const clusters: StitchGroupClipInput[][] = [];
  let current: StitchGroupClipInput[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const clip = sorted[i]!;
    const prev = current[current.length - 1]!;
    if (
      current.length < STITCH_HEURISTIC_MAX_GROUP &&
      shouldJoinHeuristic(prev, clip)
    ) {
      current.push(clip);
    } else {
      clusters.push(current);
      current = [clip];
    }
  }
  clusters.push(current);

  return clusters.map((cluster) => {
    const fileIds = cluster.map((c) => c.fileId);
    if (fileIds.length >= 2) {
      return {
        fileIds,
        kind: "stitch" as const,
        reason:
          "Recorded close together (or sequential camera names) — likely one take.",
      };
    }
    return {
      fileIds,
      kind: "solo" as const,
      reason: "No nearby continuation clip — queued on its own.",
    };
  });
}
