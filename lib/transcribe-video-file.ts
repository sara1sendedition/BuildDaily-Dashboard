import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { extractAudioMp3, probeDurationSec } from "./ffmpeg";
import { transcribeWithTimestamps } from "./transcribe";
import type { TranscriptSegment } from "./types";

export function renumberSegmentIds(segments: TranscriptSegment[]): void {
  segments.forEach((s, i) => {
    s.id = i;
  });
}

/**
 * One Whisper (or stub) pass on a video file. Used by carousel pipeline, image
 * pipeline, and POST /api/transcribe so transcript is not tied to carousel-only.
 */
export async function transcribeVideoFile(
  videoPath: string,
  options: {
    openaiApiKey: string;
    useStubLlm: boolean;
    /** When set, skips a second ffprobe. */
    durationProbed?: number;
  }
): Promise<{ transcript: TranscriptSegment[]; durationProbed: number }> {
  const durationProbed =
    options.durationProbed ?? (await probeDurationSec(videoPath));

  let transcript: TranscriptSegment[];
  if (options.useStubLlm) {
    transcript = [
      {
        id: 0,
        text: "Stub transcript. Set OPENAI_API_KEY and disable stub mode for real transcription.",
        startSec: 0,
        endSec: Math.min(30, durationProbed || 30),
      },
    ];
  } else {
    const workDir = path.join(tmpdir(), `v2t-audio-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
    try {
      const audioPath = await extractAudioMp3(videoPath, workDir);
      transcript = await transcribeWithTimestamps(
        audioPath,
        options.openaiApiKey,
        durationProbed
      );
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  renumberSegmentIds(transcript);
  return { transcript, durationProbed };
}
