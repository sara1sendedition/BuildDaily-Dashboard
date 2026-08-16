export const MIN_CUT_DURATION_SEC = 0.08;

export type TimelineRemoval = {
  id: string;
  kind: "editorial" | "dialogue";
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  reason: string;
  snippet: string;
  adjustable: boolean;
  /** When false, this editorial cut is skipped on re-run. */
  enabled: boolean;
};

export type TimelineKeepSpan = {
  start_sec: number;
  end_sec: number;
  duration_sec: number;
};

export type TimelineSequenceClipMeta = {
  id: string;
  source_start_sec: number;
  source_end_sec: number;
  duration_sec: number;
  label?: string;
  snippet?: string;
  role?: string;
};

export type TimelineData = {
  source_duration_sec: number;
  output_duration_sec: number;
  removals: TimelineRemoval[];
  keep_spans: TimelineKeepSpan[];
  sequence_clips?: TimelineSequenceClipMeta[];
};

export function formatTimelineTime(sec: number): string {
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function parseTimelineFromMeta(
  meta: Record<string, unknown> | undefined
): TimelineData | null {
  if (!meta) return null;
  const raw = meta.timeline;
  if (raw && typeof raw === "object") {
    return hydrateTimeline(raw as TimelineData);
  }
  const editorial = (meta.editorial_cuts ?? meta.editorialCuts) as
    | Array<Record<string, unknown>>
    | undefined;
  const dialogue = (meta.dialogue_trim_cuts ?? meta.dialogueTrimCuts) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!editorial?.length && !dialogue?.length) return null;

  const removals: TimelineRemoval[] = [];
  for (const c of editorial ?? []) {
    const t0 = Number(c.start_sec);
    const t1 = Number(c.end_sec);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) continue;
    removals.push({
      id: `e-${t0}-${t1}`,
      kind: "editorial",
      start_sec: t0,
      end_sec: t1,
      duration_sec: Number(c.duration_sec) || t1 - t0,
      reason: String(c.reason ?? "Editorial cut"),
      snippet: String(c.snippet ?? ""),
      adjustable: true,
      enabled: true,
    });
  }
  for (const c of dialogue ?? []) {
    const t0 = Number(c.start_sec);
    const t1 = Number(c.end_sec);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) continue;
    removals.push({
      id: `d-${t0}-${t1}`,
      kind: "dialogue",
      start_sec: t0,
      end_sec: t1,
      duration_sec: Number(c.duration_sec) || t1 - t0,
      reason: String(c.reason ?? "Non-dialogue trim"),
      snippet: "",
      adjustable: true,
      enabled: true,
    });
  }
  removals.sort((a, b) => a.start_sec - b.start_sec);
  const metaDur = Number(
    meta.source_duration_sec ??
      meta.source_input_duration_s ??
      meta.duration_s ??
      0
  );
  const maxEnd = removals.reduce((m, r) => Math.max(m, r.end_sec), 0);
  return {
    source_duration_sec:
      metaDur > 0 ? metaDur : maxEnd > 0 ? maxEnd + 1 : 60,
    output_duration_sec: 0,
    removals,
    keep_spans: [],
  };
}

function gapsFromKeepSpans(
  sourceDurationSec: number,
  keepSpans: TimelineKeepSpan[]
): Array<{ start_sec: number; end_sec: number }> {
  const total = Math.max(0, sourceDurationSec);
  if (total <= 0) return [];
  const keeps = [...keepSpans]
    .filter((k) => k.end_sec > k.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec);
  if (keeps.length === 0) return [{ start_sec: 0, end_sec: total }];
  const gaps: Array<{ start_sec: number; end_sec: number }> = [];
  let cursor = 0;
  for (const k of keeps) {
    if (k.start_sec > cursor + 0.02) {
      gaps.push({ start_sec: cursor, end_sec: k.start_sec });
    }
    cursor = Math.max(cursor, k.end_sec);
  }
  if (cursor < total - 0.02) {
    gaps.push({ start_sec: cursor, end_sec: total });
  }
  return gaps;
}

/** Add removal rows for encode gaps missing from meta (e.g. micro-keep pruning). */
export function reconcileTimelineRemovals(timeline: TimelineData): TimelineData {
  const keeps = timeline.keep_spans ?? [];
  const source = timeline.source_duration_sec;
  if (!keeps.length || source <= 0) return timeline;

  const removals = timeline.removals.map((r) => normalizeRemoval({ ...r }));
  const gapCovered = (t0: number, t1: number) => {
    const gapLen = t1 - t0;
    if (gapLen <= 1e-6) return true;
    const overlaps = removals
      .map((r) => ({
        start: Math.max(t0, r.start_sec),
        end: Math.min(t1, r.end_sec),
      }))
      .filter((iv) => iv.end > iv.start + 1e-6)
      .sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const iv of overlaps) {
      const last = merged[merged.length - 1];
      if (!last || iv.start > last.end + 1e-6) {
        merged.push({ ...iv });
      } else {
        last.end = Math.max(last.end, iv.end);
      }
    }
    const covered = merged.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
    return covered >= gapLen - 0.05;
  };

  for (const gap of gapsFromKeepSpans(source, keeps)) {
    if (gapCovered(gap.start_sec, gap.end_sec)) continue;
    removals.push(
      normalizeRemoval({
        id: `d-${gap.start_sec.toFixed(2)}-${gap.end_sec.toFixed(2)}`,
        kind: "dialogue",
        start_sec: gap.start_sec,
        end_sec: gap.end_sec,
        duration_sec: gap.end_sec - gap.start_sec,
        reason: "Trimmed segment (see Timeline tab)",
        snippet: "",
        adjustable: true,
        enabled: true,
      })
    );
  }
  removals.sort((a, b) => a.start_sec - b.start_sec);
  return { ...timeline, removals };
}

function hydrateTimeline(data: TimelineData): TimelineData {
  const hydrated: TimelineData = {
    ...data,
    removals: (data.removals ?? []).map((r) =>
      normalizeRemoval({
        ...r,
        enabled: r.enabled ?? true,
        adjustable: r.adjustable ?? true,
      })
    ),
    keep_spans: data.keep_spans ?? [],
  };
  return reconcileTimelineRemovals(hydrated);
}

export function roundTimelineSec(sec: number): number {
  return Math.round(sec * 100) / 100;
}

export function normalizeRemoval(r: TimelineRemoval): TimelineRemoval {
  const start_sec = roundTimelineSec(Math.max(0, r.start_sec));
  const end_sec = roundTimelineSec(
    Math.max(start_sec + MIN_CUT_DURATION_SEC, r.end_sec)
  );
  return {
    ...r,
    start_sec,
    end_sec,
    duration_sec: roundTimelineSec(end_sec - start_sec),
  };
}

export function clampRemovalSpan(
  start: number,
  end: number,
  duration: number,
  edge: "start" | "end",
  minLen: number = MIN_CUT_DURATION_SEC
): { start_sec: number; end_sec: number } {
  let start_sec = roundTimelineSec(start);
  let end_sec = roundTimelineSec(end);
  start_sec = Math.max(0, Math.min(start_sec, duration));
  end_sec = Math.max(0, Math.min(end_sec, duration));
  if (end_sec - start_sec < minLen) {
    if (edge === "start") {
      start_sec = roundTimelineSec(end_sec - minLen);
    } else {
      end_sec = roundTimelineSec(start_sec + minLen);
    }
  }
  start_sec = Math.max(0, start_sec);
  end_sec = Math.min(duration, Math.max(end_sec, start_sec + minLen));
  return { start_sec, end_sec };
}

export function timelineRemovalsChanged(
  current: TimelineRemoval[],
  initial: TimelineRemoval[]
): boolean {
  const key = (list: TimelineRemoval[]) =>
    JSON.stringify(
      list
        .filter((r) => r.enabled)
        .map((r) => ({
          id: r.id,
          start: r.start_sec,
          end: r.end_sec,
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    );
  const disabledChanged = current.some((r) => {
    const orig = initial.find((o) => o.id === r.id);
    return Boolean(orig && r.enabled !== orig.enabled);
  });
  return key(current) !== key(initial) || disabledChanged;
}

export function removalsForReprocess(removals: TimelineRemoval[]): string {
  return JSON.stringify(
    removals
      .filter((r) => r.enabled)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        start_sec: r.start_sec,
        end_sec: r.end_sec,
        duration_sec: r.duration_sec,
        reason: r.reason,
        snippet: r.snippet,
      }))
  );
}

/** Script word toggles only change editorial cuts — omit dialogue trims so the backend recomputes pauses/silence for the new layout. */
export function editorialRemovalsOnly(
  removals: TimelineRemoval[]
): TimelineRemoval[] {
  return removals.filter((r) => r.kind === "editorial");
}

/** Stable key for resetting local editor state when server baseline changes. */
export function timelineRemovalsFingerprint(removals: TimelineRemoval[]): string {
  return JSON.stringify(
    removals
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        start: r.start_sec,
        end: r.end_sec,
        enabled: r.enabled,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}
