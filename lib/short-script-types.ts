import {
  formatTimelineTime,
  normalizeRemoval,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";

export type TranscriptScriptTokenKind = "word" | "gap";

export type TranscriptScriptWord = {
  id: number;
  start_sec: number;
  end_sec: number;
  text: string;
  kind: TranscriptScriptTokenKind;
  removed: boolean;
  removal_kinds: string[];
};

/** @deprecated Legacy line-based script; use `words`. */
export type TranscriptScriptSegment = TranscriptScriptWord;

export type TranscriptScriptData = {
  words: TranscriptScriptWord[];
};

const EPS = 1e-6;
const MIN_SPLIT_SEC = 0.02;

function parseToken(row: Record<string, unknown>): TranscriptScriptWord | null {
  const id = Number(row.id);
  const start_sec = Number(row.start_sec);
  const end_sec = Number(row.end_sec);
  const text = String(row.text ?? "").trim();
  if (!Number.isFinite(id) || !Number.isFinite(start_sec) || !Number.isFinite(end_sec)) {
    return null;
  }
  if (!text || end_sec <= start_sec) return null;
  const kindRaw = String(row.kind ?? "");
  const kind: TranscriptScriptTokenKind =
    kindRaw === "gap" || text.startsWith("(No speech") ? "gap" : "word";
  return {
    id,
    start_sec,
    end_sec,
    text,
    kind,
    removed: Boolean(row.removed),
    removal_kinds: Array.isArray(row.removal_kinds)
      ? row.removal_kinds.map(String)
      : [],
  };
}

export function parseScriptFromMeta(
  meta: Record<string, unknown> | undefined
): TranscriptScriptData | null {
  if (!meta) return null;
  const raw = meta.transcript_script ?? meta.transcriptScript;
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;

  const wordsRaw = bag.words;
  if (Array.isArray(wordsRaw) && wordsRaw.length > 0) {
    const words: TranscriptScriptWord[] = [];
    for (const item of wordsRaw) {
      if (!item || typeof item !== "object") continue;
      const token = parseToken(item as Record<string, unknown>);
      if (token) words.push(token);
    }
    return words.length > 0 ? { words } : null;
  }

  const segmentsRaw = bag.segments;
  if (!Array.isArray(segmentsRaw) || segmentsRaw.length === 0) return null;
  const words: TranscriptScriptWord[] = [];
  for (const item of segmentsRaw) {
    if (!item || typeof item !== "object") continue;
    const token = parseToken(item as Record<string, unknown>);
    if (token) words.push(token);
  }
  return words.length > 0 ? { words } : null;
}

export function scriptWordCount(script: TranscriptScriptData): number {
  return script.words.filter((w) => w.kind === "word").length;
}

export function tokenMidpoint(token: TranscriptScriptWord): number {
  return (token.start_sec + token.end_sec) / 2;
}

export function isWordRemovedByRemovals(
  word: TranscriptScriptWord,
  removals: TimelineRemoval[]
): boolean {
  const mid = tokenMidpoint(word);
  return removals.some(
    (r) => r.enabled && mid >= r.start_sec - EPS && mid <= r.end_sec + EPS
  );
}

function removalForSpan(
  start_sec: number,
  end_sec: number,
  duration: number,
  snippet: string,
  idSuffix: string,
  kind: TimelineRemoval["kind"],
  reason: string
): TimelineRemoval {
  return normalizeRemoval({
    id: `w-${idSuffix}-${start_sec.toFixed(2)}-${end_sec.toFixed(2)}`,
    kind,
    start_sec: Math.max(0, start_sec),
    end_sec: Math.min(duration, end_sec),
    duration_sec: end_sec - start_sec,
    reason,
    snippet,
    adjustable: true,
    enabled: true,
  });
}

function splitRemovalAroundWord(
  removals: TimelineRemoval[],
  removal: TimelineRemoval,
  word: TranscriptScriptWord,
  duration: number
): TimelineRemoval[] {
  let next = removals.filter((r) => r.id !== removal.id);
  const rs = removal.start_sec;
  const re = removal.end_sec;
  const ws = word.start_sec;
  const we = word.end_sec;
  const snippet = removal.snippet || word.text;
  const reason = removal.reason || "Manual script cut";
  if (rs < ws - MIN_SPLIT_SEC) {
    next.push(
      removalForSpan(
        rs,
        ws,
        duration,
        snippet,
        `${removal.id}-L`,
        removal.kind,
        reason
      )
    );
  }
  if (re > we + MIN_SPLIT_SEC) {
    next.push(
      removalForSpan(
        we,
        re,
        duration,
        snippet,
        `${removal.id}-R`,
        removal.kind,
        reason
      )
    );
  }
  return next.sort((a, b) => a.start_sec - b.start_sec);
}

/** Toggle keep/cut for one word (or gap block); returns updated removals. */
export function toggleWordInRemovals(
  word: TranscriptScriptWord,
  removals: TimelineRemoval[],
  duration: number
): TimelineRemoval[] {
  const mid = tokenMidpoint(word);
  const active = removals.filter(
    (r) =>
      r.enabled && mid >= r.start_sec - EPS && mid <= r.end_sec + EPS
  );

  if (active.length > 0) {
    let next = [...removals];
    for (const r of active) {
      next = splitRemovalAroundWord(next, r, word, duration);
    }
    return next;
  }

  const reEnable = removals.find(
    (r) =>
      !r.enabled &&
      r.kind === "editorial" &&
      r.start_sec <= word.start_sec + 0.05 &&
      r.end_sec >= word.end_sec - 0.05
  );
  if (reEnable) {
    return removals.map((r) =>
      r.id === reEnable.id ? { ...r, enabled: true } : r
    );
  }

  const snippet =
    word.text.length > 160 ? `${word.text.slice(0, 157)}…` : word.text;
  const cut = removalForSpan(
    word.start_sec,
    word.end_sec,
    duration,
    snippet,
    String(word.id),
    "editorial",
    "Manual script cut"
  );
  return [...removals, cut].sort((a, b) => a.start_sec - b.start_sec);
}

/** @deprecated Use toggleWordInRemovals */
export const toggleSegmentInRemovals = toggleWordInRemovals;

/** @deprecated Use isWordRemovedByRemovals */
export const isSegmentRemovedByRemovals = isWordRemovedByRemovals;

export function scriptWordTimeLabel(word: TranscriptScriptWord): string {
  return `${formatTimelineTime(word.start_sec)}–${formatTimelineTime(word.end_sec)}`;
}

/** @deprecated */
export const scriptSegmentTimeLabel = scriptWordTimeLabel;

const PARAGRAPH_PAUSE_SEC = 0.72;

export function groupWordsIntoParagraphs(
  words: TranscriptScriptWord[]
): TranscriptScriptWord[][] {
  const paragraphs: TranscriptScriptWord[][] = [];
  let current: TranscriptScriptWord[] = [];

  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(current);
      current = [];
    }
  };

  for (const w of words) {
    if (w.kind === "gap") {
      flush();
      paragraphs.push([w]);
      continue;
    }
    if (current.length > 0) {
      const prev = current[current.length - 1]!;
      const gap = w.start_sec - prev.end_sec;
      if (gap > PARAGRAPH_PAUSE_SEC) flush();
    }
    current.push(w);
  }
  flush();
  return paragraphs;
}
