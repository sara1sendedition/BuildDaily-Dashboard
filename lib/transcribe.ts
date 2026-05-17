import OpenAI from "openai";
import { createReadStream } from "fs";
import type { TranscriptSegment } from "./types";

export async function transcribeWithTimestamps(
  audioPath: string,
  apiKey: string,
  /** From ffprobe on the video; improves timing when Whisper omits segment end times. */
  mediaDurationSec?: number
): Promise<TranscriptSegment[]> {
  const openai = new OpenAI({ apiKey });

  const response = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const raw = response as unknown as {
    segments?: Array<{ id: number; start: number; end: number; text: string }>;
    text?: string;
    duration?: number;
  };

  const apiDuration =
    typeof raw.duration === "number" && raw.duration > 0 ? raw.duration : 0;

  const segments: TranscriptSegment[] = [];
  if (raw.segments?.length) {
    for (const s of raw.segments) {
      segments.push({
        id: s.id,
        text: s.text.trim(),
        startSec: s.start,
        endSec: s.end,
      });
    }
  } else if (raw.text?.trim()) {
    segments.push({
      id: 0,
      text: raw.text.trim(),
      startSec: 0,
      endSec: apiDuration > 0 ? apiDuration : 0,
    });
  }

  const hint = Math.max(apiDuration, mediaDurationSec ?? 0);
  normalizeSegmentTimes(segments, hint);
  return segments;
}

/**
 * Whisper sometimes returns one blob with end=0, or segments with no usable span.
 * Without valid times, every slide maps to the first frame.
 */
export function normalizeSegmentTimes(
  segments: TranscriptSegment[],
  durationHintSec: number
): void {
  const n = segments.length;
  if (n === 0) return;

  const d = Math.max(0.1, durationHintSec);

  if (n === 1) {
    const s = segments[0];
    if (s.endSec <= s.startSec + 0.01 || s.endSec < 0.05) {
      s.endSec = Math.max(s.startSec + 0.5, d);
    }
    return;
  }

  const timesBad = segments.every(
    (s) => !Number.isFinite(s.endSec) || s.endSec <= s.startSec + 0.02
  );
  if (timesBad) {
    const step = d / n;
    segments.forEach((s, i) => {
      s.startSec = i * step;
      s.endSec = (i + 1) * step;
    });
  }
}
