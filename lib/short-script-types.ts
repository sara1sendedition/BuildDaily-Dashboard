import {
  formatTimelineTime,
  normalizeRemoval,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";

export type TranscriptScriptSegment = {
  id: number;
  start_sec: number;
  end_sec: number;
  text: string;
  removed: boolean;
  removal_kinds: string[];
};

export type TranscriptScriptData = {
  segments: TranscriptScriptSegment[];
};

export function parseScriptFromMeta(
  meta: Record<string, unknown> | undefined
): TranscriptScriptData | null {
  if (!meta) return null;
  const raw = meta.transcript_script ?? meta.transcriptScript;
  if (!raw || typeof raw !== "object") return null;
  const segmentsRaw = (raw as TranscriptScriptData).segments;
  if (!Array.isArray(segmentsRaw) || segmentsRaw.length === 0) return null;

  const segments: TranscriptScriptSegment[] = [];
  for (const item of segmentsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    const start_sec = Number(row.start_sec);
    const end_sec = Number(row.end_sec);
    const text = String(row.text ?? "").trim();
    if (
      !Number.isFinite(id) ||
      !Number.isFinite(start_sec) ||
      !Number.isFinite(end_sec)
    ) {
      continue;
    }
    if (!text || end_sec <= start_sec) continue;
    segments.push({
      id,
      start_sec,
      end_sec,
      text,
      removed: Boolean(row.removed),
      removal_kinds: Array.isArray(row.removal_kinds)
        ? row.removal_kinds.map(String)
        : [],
    });
  }
  return segments.length > 0 ? { segments } : null;
}

export function segmentMidpoint(seg: TranscriptScriptSegment): number {
  return (seg.start_sec + seg.end_sec) / 2;
}

export function isSegmentRemovedByRemovals(
  seg: TranscriptScriptSegment,
  removals: TimelineRemoval[]
): boolean {
  const mid = segmentMidpoint(seg);
  return removals.some(
    (r) => r.enabled && mid >= r.start_sec - 1e-6 && mid <= r.end_sec + 1e-6
  );
}

export function toggleSegmentInRemovals(
  seg: TranscriptScriptSegment,
  removals: TimelineRemoval[],
  duration: number
): TimelineRemoval[] {
  const currentlyRemoved = isSegmentRemovedByRemovals(seg, removals);

  if (currentlyRemoved) {
    const mid = segmentMidpoint(seg);
    return removals.map((r) => {
      if (!r.enabled) return r;
      if (mid >= r.start_sec - 1e-6 && mid <= r.end_sec + 1e-6) {
        return { ...r, enabled: false };
      }
      return r;
    });
  }

  const reEnable = removals.find(
    (r) =>
      !r.enabled &&
      r.kind === "editorial" &&
      r.start_sec <= seg.start_sec + 0.05 &&
      r.end_sec >= seg.end_sec - 0.05
  );
  if (reEnable) {
    return removals.map((r) =>
      r.id === reEnable.id ? { ...r, enabled: true } : r
    );
  }

  const snippet =
    seg.text.length > 160 ? `${seg.text.slice(0, 157)}…` : seg.text;
  const next: TimelineRemoval = normalizeRemoval({
    id: `s-${seg.id}-${seg.start_sec.toFixed(2)}-${seg.end_sec.toFixed(2)}`,
    kind: "editorial",
    start_sec: Math.max(0, seg.start_sec),
    end_sec: Math.min(duration, seg.end_sec),
    duration_sec: seg.end_sec - seg.start_sec,
    reason: "Manual script cut",
    snippet,
    adjustable: true,
    enabled: true,
  });
  return [...removals, next].sort((a, b) => a.start_sec - b.start_sec);
}

export function scriptSegmentTimeLabel(seg: TranscriptScriptSegment): string {
  return `${formatTimelineTime(seg.start_sec)}–${formatTimelineTime(seg.end_sec)}`;
}
