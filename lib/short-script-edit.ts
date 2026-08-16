import {
  isWordRemovedByRemovals,
  type TranscriptScriptData,
  type TranscriptScriptWord,
} from "@/lib/short-script-types";
import type { TimelineSequenceClip } from "@/lib/short-sequence-types";
import {
  normalizeRemoval,
  timelineRemovalsChanged,
  timelineRemovalsFingerprint,
  type TimelineData,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";

export type ScriptTextOverride = {
  ordinal: number;
  text: string;
};

export type ScriptTextEditsPayload = {
  overrides: ScriptTextOverride[];
};

export type ScriptLine = {
  text: string;
  tokens: TranscriptScriptWord[];
};

export type ScriptTextEditResult = {
  edits: ScriptTextEditsPayload | null;
  removals: TimelineRemoval[];
  deletedCount: number;
  overrideCount: number;
  insertedCount: number;
};

const EPS = 1e-6;
const PARAGRAPH_PAUSE_SEC = 0.72;

export function scriptSpeechWords(
  script: TranscriptScriptData
): TranscriptScriptWord[] {
  return script.words.filter((w) => w.kind === "word");
}

export function groupSpeechWordsIntoParagraphs(
  speechWords: TranscriptScriptWord[]
): TranscriptScriptWord[][] {
  const paragraphs: TranscriptScriptWord[][] = [];
  let current: TranscriptScriptWord[] = [];

  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(current);
      current = [];
    }
  };

  for (const w of speechWords) {
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

/** Full spoken transcript for Edit text — every word, including sections already cut. */
export function scriptToEditableText(script: TranscriptScriptData): string {
  return scriptToLines(script)
    .map((line) => line.text)
    .join("\n");
}

export function scriptToLines(script: TranscriptScriptData): ScriptLine[] {
  return groupSpeechWordsIntoParagraphs(scriptSpeechWords(script)).map(
    (para) => ({
      text: para.map((w) => w.text).join(" "),
      tokens: para,
    })
  );
}

/** Ensure AI-marked ``removed`` words are reflected in timeline removals on load. */
export function mergeRemovalsFromScriptFlags(
  script: TranscriptScriptData,
  removals: TimelineRemoval[]
): TimelineRemoval[] {
  let next = [...removals];
  for (const w of script.words) {
    if (!w.removed || w.kind !== "word") continue;
    next = addTokenRemoval(w, next);
  }
  return next;
}

function splitEditedLine(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

type AlignOp =
  | { kind: "align"; origIndex: number; editIndex: number }
  | { kind: "delete"; origIndex: number }
  | { kind: "insert"; editIndex: number };

/** Prefer substitute over delete+insert so typos become caption fixes, not cuts. */
function alignTokens(original: string[], edited: string[]): AlignOp[] {
  const n = original.length;
  const m = edited.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    dp[i]![0] = i;
  }
  for (let j = 1; j <= m; j++) {
    dp[0]![j] = j;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = dp[i - 1]![j - 1]!;
      const del = dp[i - 1]![j]! + 1;
      const ins = dp[i]![j - 1]! + 1;
      dp[i]![j] = Math.min(sub, del, ins);
    }
  }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]!) {
      ops.push({ kind: "align", origIndex: i - 1, editIndex: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }
    if (i > 0 && (j === 0 || dp[i]![j] === dp[i - 1]![j]! + 1)) {
      ops.push({ kind: "delete", origIndex: i - 1 });
      i -= 1;
      continue;
    }
    ops.push({ kind: "insert", editIndex: j - 1 });
    j -= 1;
  }
  ops.reverse();
  return ops;
}

function alignLines(
  original: ScriptLine[],
  editedLines: string[]
): Array<
  | { kind: "line"; orig: ScriptLine; edited: string }
  | { kind: "delete_line"; orig: ScriptLine }
  | { kind: "insert_line"; edited: string }
> {
  const origTexts = original.map((l) => l.text);
  const ops = alignTokens(origTexts, editedLines);
  const out: Array<
    | { kind: "line"; orig: ScriptLine; edited: string }
    | { kind: "delete_line"; orig: ScriptLine }
    | { kind: "insert_line"; edited: string }
  > = [];
  for (const op of ops) {
    if (op.kind === "align") {
      out.push({
        kind: "line",
        orig: original[op.origIndex]!,
        edited: editedLines[op.editIndex] ?? "",
      });
    } else if (op.kind === "delete") {
      out.push({ kind: "delete_line", orig: original[op.origIndex]! });
    } else {
      out.push({
        kind: "insert_line",
        edited: editedLines[op.editIndex] ?? "",
      });
    }
  }
  return out;
}

function removalForToken(token: TranscriptScriptWord): TimelineRemoval {
  const snippet =
    token.text.length > 160 ? `${token.text.slice(0, 157)}…` : token.text;
  return normalizeRemoval({
    id: `script-edit-${token.id}-${token.start_sec.toFixed(2)}`,
    kind: "editorial",
    start_sec: token.start_sec,
    end_sec: token.end_sec,
    duration_sec: token.end_sec - token.start_sec,
    reason: "Script text removed",
    snippet,
    adjustable: true,
    enabled: true,
  });
}

function addTokenRemoval(
  token: TranscriptScriptWord,
  removals: TimelineRemoval[]
): TimelineRemoval[] {
  const mid = (token.start_sec + token.end_sec) / 2;
  const already = removals.some(
    (r) => r.enabled && mid >= r.start_sec - EPS && mid <= r.end_sec + EPS
  );
  if (already) return removals;
  return [...removals, removalForToken(token)].sort(
    (a, b) => a.start_sec - b.start_sec
  );
}

function speechTokens(tokens: TranscriptScriptWord[]): TranscriptScriptWord[] {
  return tokens.filter((t) => t.kind === "word");
}

export function computeScriptTextEdits(
  script: TranscriptScriptData,
  editedText: string,
  removals: TimelineRemoval[]
): ScriptTextEditResult {
  const originalLines = scriptToLines(script);
  const editedLines = editedText.replace(/\r\n/g, "\n").split("\n");
  const lineOps = alignLines(originalLines, editedLines);

  const deletedIds = new Set<number>();
  const replacements: { wordId: number; text: string }[] = [];
  let insertedCount = 0;
  let nextRemovals = [...removals];

  for (const op of lineOps) {
    if (op.kind === "delete_line") {
      for (const token of op.orig.tokens) {
        deletedIds.add(token.id);
        nextRemovals = addTokenRemoval(token, nextRemovals);
      }
      continue;
    }
    if (op.kind === "insert_line") {
      insertedCount += splitEditedLine(op.edited).length;
      continue;
    }

    const origSpeech = speechTokens(op.orig.tokens);
    const editedWords = splitEditedLine(op.edited);
    if (origSpeech.length === 0 && op.orig.tokens.length > 0) {
      if (editedWords.length === 0) {
        for (const token of op.orig.tokens) {
          deletedIds.add(token.id);
          nextRemovals = addTokenRemoval(token, nextRemovals);
        }
      }
      continue;
    }

    const tokenOps = alignTokens(
      origSpeech.map((w) => w.text),
      editedWords
    );
    for (const tokenOp of tokenOps) {
      if (tokenOp.kind === "delete") {
        const token = origSpeech[tokenOp.origIndex]!;
        deletedIds.add(token.id);
        nextRemovals = addTokenRemoval(token, nextRemovals);
      } else if (tokenOp.kind === "insert") {
        insertedCount += 1;
      } else {
        const token = origSpeech[tokenOp.origIndex]!;
        const newText = editedWords[tokenOp.editIndex] ?? "";
        if (!newText) continue;
        if (newText !== token.text) {
          replacements.push({ wordId: token.id, text: newText });
        }
      }
    }
  }

  // Ordinals must match kept speech in the encoded output (same order the backend
  // uses after timeline cuts), not the full source transcript.
  const keptSpeech = script.words.filter(
    (w) =>
      w.kind === "word" &&
      !w.removed &&
      !deletedIds.has(w.id) &&
      !isWordRemovedByRemovals(w, nextRemovals)
  );
  const overrides: ScriptTextOverride[] = [];
  const idToOrdinal = new Map(
    keptSpeech.map((w, ordinal) => [w.id, ordinal] as const)
  );
  for (const rep of replacements) {
    const ordinal = idToOrdinal.get(rep.wordId);
    if (ordinal === undefined) continue;
    overrides.push({ ordinal, text: rep.text });
  }

  const hasEdits = deletedIds.size > 0 || overrides.length > 0;
  return {
    edits: hasEdits ? { overrides } : null,
    removals: nextRemovals,
    deletedCount: deletedIds.size,
    overrideCount: overrides.length,
    insertedCount,
  };
}

export function scriptTextEditChanged(
  script: TranscriptScriptData,
  editedText: string
): boolean {
  return editedText.replace(/\r\n/g, "\n") !== scriptToEditableText(script);
}

export function scriptEditsForReprocess(
  edits: ScriptTextEditsPayload | null
): string {
  if (!edits || edits.overrides.length === 0) return "";
  return JSON.stringify(edits);
}

function removalsByKind(
  removals: TimelineRemoval[],
  kind: TimelineRemoval["kind"]
): TimelineRemoval[] {
  return removals.filter((r) => r.kind === kind);
}

/**
 * Preserve server dialogue trims when the user only changed editorial/script cuts.
 * Dropping dialogue trims forces the backend to re-plan pause trims non-deterministically.
 */
export function stableRemovalsForReprocess(
  current: TimelineRemoval[],
  baseline: TimelineRemoval[] | null | undefined
): TimelineRemoval[] {
  if (!baseline?.length) return current;
  const baseDialogue = removalsByKind(baseline, "dialogue");
  const curDialogue = removalsByKind(current, "dialogue");
  // Script-editor re-runs often send editorial-only cuts; preserve server dialogue trims
  // unless the user actually edited dialogue spans on the Timeline tab.
  const dialogueUserEdited =
    curDialogue.length > 0 &&
    timelineRemovalsChanged(curDialogue, baseDialogue);
  if (dialogueUserEdited) return current;
  const curEditorial = removalsByKind(current, "editorial");
  const seen = new Set<string>();
  return [...curEditorial, ...baseDialogue]
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .sort((a, b) => a.start_sec - b.start_sec);
}

export type ScriptReprocessDraft = {
  script: TranscriptScriptData;
  draftText: string;
  removals: TimelineRemoval[];
  sequenceClips?: TimelineSequenceClip[];
  sequenceDirty?: boolean;
};

/** Compute caption overrides + stable removals from the live script editor draft. */
export function buildScriptReprocessFromDraft(
  draft: ScriptReprocessDraft,
  baselineRemovals: TimelineRemoval[] | null | undefined
): {
  removals: TimelineRemoval[];
  scriptEdits: ScriptTextEditsPayload | null;
} {
  const result = computeScriptTextEdits(
    draft.script,
    draft.draftText,
    draft.removals
  );
  return {
    removals: stableRemovalsForReprocess(result.removals, baselineRemovals),
    scriptEdits: result.edits,
  };
}

/** Caption overrides persisted on the job after a script text re-run. */
export function parseScriptTextOverridesFromMeta(
  meta: Record<string, unknown> | undefined
): ScriptTextEditsPayload | null {
  if (!meta) return null;
  const raw = meta.script_text_overrides;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const overrides: ScriptTextOverride[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const ordinal = Number(row.ordinal);
    const text = String(row.text ?? "").trim();
    if (!Number.isFinite(ordinal) || ordinal < 0 || !text) continue;
    overrides.push({ ordinal: Math.floor(ordinal), text });
  }
  return overrides.length > 0 ? { overrides } : null;
}

/** Stable key for resetting local editor state when server baseline changes. */
export function buildScriptEditorBaselineKey(
  jobId: string,
  meta: Record<string, unknown>,
  timeline: TimelineData | null,
  script: TranscriptScriptData | null
): string {
  const tl = timeline
    ? timelineRemovalsFingerprint(timeline.removals)
    : "";
  const seq = timeline?.sequence_clips?.length
    ? JSON.stringify(
        timeline.sequence_clips.map((c) => ({
          id: c.id,
          start: c.source_start_sec,
          end: c.source_end_sec,
        }))
      )
    : "";
  const words = script?.words.length ?? 0;
  const rev = Number(meta.output_revision ?? meta.outputRevision ?? 0);
  const overrideSig = JSON.stringify(meta.script_text_overrides ?? null);
  return `${jobId}:${rev}:${tl}:${seq}:${words}:${overrideSig}`;
}
