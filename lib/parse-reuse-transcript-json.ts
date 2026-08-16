import type { TranscriptSegment } from "./types";

function coerceSec(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseSegment(value: unknown, index: number): TranscriptSegment | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) return null;

  const startSec = coerceSec(o.startSec) ?? coerceSec(o.start);
  const endSec = coerceSec(o.endSec) ?? coerceSec(o.end);
  if (startSec === null || endSec === null) return null;

  return {
    id: typeof o.id === "number" && Number.isFinite(o.id) ? o.id : index,
    text,
    startSec,
    endSec,
  };
}

/** Normalize transcript arrays for reuseTranscription (skip bad segments, re-number ids). */
export function normalizeTranscriptSegments(
  input: unknown
): TranscriptSegment[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: TranscriptSegment[] = [];
  for (let i = 0; i < input.length; i++) {
    const segment = parseSegment(input[i], i);
    if (segment) out.push(segment);
  }
  if (out.length === 0) return null;
  out.forEach((segment, i) => {
    segment.id = i;
  });
  return out;
}

/** JSON from client when skipping Whisper (Edit Carousel / shared transcript). */
export function parseReuseTranscriptJson(raw: string): TranscriptSegment[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return normalizeTranscriptSegments(JSON.parse(trimmed));
  } catch {
    return null;
  }
}
