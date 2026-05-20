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

export type TimelineData = {
  source_duration_sec: number;
  output_duration_sec: number;
  removals: TimelineRemoval[];
  keep_spans: TimelineKeepSpan[];
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
  const maxEnd = removals.reduce((m, r) => Math.max(m, r.end_sec), 0);
  return {
    source_duration_sec: maxEnd > 0 ? maxEnd + 1 : 60,
    output_duration_sec: 0,
    removals,
    keep_spans: [],
  };
}

function hydrateTimeline(data: TimelineData): TimelineData {
  return {
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
