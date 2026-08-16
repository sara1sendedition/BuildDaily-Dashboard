import {
  formatTimelineTime,
  roundTimelineSec,
  type TimelineData,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";
import { tokenMidpoint, type TranscriptScriptData } from "@/lib/short-script-types";

export const MIN_CLIP_DURATION_SEC = 0.15;

export type TimelineSequenceClip = {
  id: string;
  source_start_sec: number;
  source_end_sec: number;
  duration_sec: number;
  label: string;
  snippet: string;
  role?: string;
};

export function clipDuration(clip: TimelineSequenceClip): number {
  return Math.max(0, clip.source_end_sec - clip.source_start_sec);
}

export function sequenceOutputDuration(clips: TimelineSequenceClip[]): number {
  return clips.reduce((sum, c) => sum + clipDuration(c), 0);
}

export function normalizeSequenceClip(
  clip: TimelineSequenceClip,
  maxEnd?: number
): TimelineSequenceClip {
  let start = roundTimelineSec(Math.max(0, clip.source_start_sec));
  let end = roundTimelineSec(clip.source_end_sec);
  if (maxEnd != null && Number.isFinite(maxEnd)) {
    end = Math.min(end, maxEnd);
    start = Math.min(start, maxEnd);
  }
  if (end - start < MIN_CLIP_DURATION_SEC) {
    end = roundTimelineSec(start + MIN_CLIP_DURATION_SEC);
    if (maxEnd != null) end = Math.min(end, maxEnd);
  }
  const duration = roundTimelineSec(
    Math.max(MIN_CLIP_DURATION_SEC, end - start)
  );
  return {
    ...clip,
    source_start_sec: start,
    source_end_sec: roundTimelineSec(start + duration),
    duration_sec: duration,
  };
}

function keepsFromRemovals(
  removals: TimelineRemoval[],
  sourceDuration: number
): Array<{ start_sec: number; end_sec: number }> {
  const cuts = removals
    .filter((r) => r.enabled)
    .sort((a, b) => a.start_sec - b.start_sec);
  const keeps: Array<{ start_sec: number; end_sec: number }> = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start_sec > cursor + 0.02) {
      keeps.push({ start_sec: cursor, end_sec: c.start_sec });
    }
    cursor = Math.max(cursor, c.end_sec);
  }
  if (cursor < sourceDuration - 0.02) {
    keeps.push({ start_sec: cursor, end_sec: sourceDuration });
  }
  if (!keeps.length && sourceDuration > 0) {
    keeps.push({ start_sec: 0, end_sec: sourceDuration });
  }
  return keeps;
}

function snippetForSpan(
  script: TranscriptScriptData | null | undefined,
  start: number,
  end: number
): string {
  if (!script?.words.length) return "";
  const parts = script.words
    .filter((w) => w.kind === "word")
    .filter((w) => {
      const mid = tokenMidpoint(w);
      return mid >= start - 1e-3 && mid <= end + 1e-3;
    })
    .map((w) => w.text);
  const text = parts.join(" ").trim();
  if (text.length <= 72) return text;
  return `${text.slice(0, 71)}…`;
}

/** Build keep-cards from the current cut list (disabled cuts are kept in the output). */
export function deriveSequenceClipsFromRemovals(
  removals: TimelineRemoval[],
  sourceDurationSec: number,
  script?: TranscriptScriptData | null
): TimelineSequenceClip[] {
  const keeps = keepsFromRemovals(removals, sourceDurationSec);
  return keeps.map((k, i) =>
    normalizeSequenceClip(
      {
        id: `clip-${i}-${k.start_sec.toFixed(2)}`,
        source_start_sec: k.start_sec,
        source_end_sec: k.end_sec,
        duration_sec: k.end_sec - k.start_sec,
        label: `Clip ${i + 1}`,
        snippet: snippetForSpan(script, k.start_sec, k.end_sec),
      },
      sourceDurationSec
    )
  );
}

export function deriveSequenceClips(
  timeline: TimelineData,
  script?: TranscriptScriptData | null
): TimelineSequenceClip[] {
  const raw = timeline.sequence_clips ?? [];
  if (raw.length) {
    return raw.map((c) =>
      normalizeSequenceClip(
        {
          id: c.id,
          source_start_sec: c.source_start_sec,
          source_end_sec: c.source_end_sec,
          duration_sec: c.duration_sec,
          label: c.label ?? "",
          snippet: c.snippet ?? "",
          role: c.role,
        },
        timeline.source_duration_sec
      )
    );
  }
  if (timeline.keep_spans?.length) {
    return [...timeline.keep_spans]
      .sort((a, b) => a.start_sec - b.start_sec)
      .map((k, i) =>
        normalizeSequenceClip(
          {
            id: `clip-${i}-${k.start_sec.toFixed(2)}`,
            source_start_sec: k.start_sec,
            source_end_sec: k.end_sec,
            duration_sec: k.end_sec - k.start_sec,
            label: `Clip ${i + 1}`,
            snippet: snippetForSpan(script, k.start_sec, k.end_sec),
          },
          timeline.source_duration_sec
        )
      );
  }
  return deriveSequenceClipsFromRemovals(
    timeline.removals,
    timeline.source_duration_sec,
    script
  );
}

/** Map a source time onto the output playhead (nearest clip edge if the time was cut). */
export function outputTimeForSource(
  clips: TimelineSequenceClip[],
  sourceSec: number
): number {
  let cursor = 0;
  for (const clip of clips) {
    if (
      sourceSec >= clip.source_start_sec - 1e-3 &&
      sourceSec <= clip.source_end_sec + 1e-3
    ) {
      return cursor + (sourceSec - clip.source_start_sec);
    }
    if (sourceSec < clip.source_start_sec) {
      return cursor;
    }
    cursor += clipDuration(clip);
  }
  return Math.max(0, cursor);
}

export function clampClipSpan(
  clip: TimelineSequenceClip,
  edge: "start" | "end",
  sec: number,
  maxSource: number
): TimelineSequenceClip {
  if (!Number.isFinite(sec)) return clip;
  const start = edge === "start" ? sec : clip.source_start_sec;
  const end = edge === "end" ? sec : clip.source_end_sec;
  let start_sec = roundTimelineSec(Math.max(0, Math.min(start, maxSource)));
  let end_sec = roundTimelineSec(Math.max(0, Math.min(end, maxSource)));
  if (end_sec - start_sec < MIN_CLIP_DURATION_SEC) {
    if (edge === "start") {
      start_sec = roundTimelineSec(end_sec - MIN_CLIP_DURATION_SEC);
    } else {
      end_sec = roundTimelineSec(start_sec + MIN_CLIP_DURATION_SEC);
    }
  }
  start_sec = Math.max(0, start_sec);
  end_sec = Math.min(
    maxSource,
    Math.max(end_sec, start_sec + MIN_CLIP_DURATION_SEC)
  );
  return normalizeSequenceClip(
    {
      ...clip,
      source_start_sec: start_sec,
      source_end_sec: end_sec,
      duration_sec: end_sec - start_sec,
    },
    maxSource
  );
}

export function sequenceClipsFingerprint(clips: TimelineSequenceClip[]): string {
  return JSON.stringify(
    clips.map((c) => ({
      id: c.id,
      start: c.source_start_sec,
      end: c.source_end_sec,
    }))
  );
}

export function sequenceClipsChanged(
  current: TimelineSequenceClip[],
  initial: TimelineSequenceClip[]
): boolean {
  return sequenceClipsFingerprint(current) !== sequenceClipsFingerprint(initial);
}

export function sequenceClipsForReprocess(clips: TimelineSequenceClip[]): string {
  return JSON.stringify(
    clips.map((c) => ({
      id: c.id,
      source_start_sec: c.source_start_sec,
      source_end_sec: c.source_end_sec,
      duration_sec: c.duration_sec,
      label: c.label,
      snippet: c.snippet,
      role: c.role ?? "",
    }))
  );
}

export type SequencePlayhead = {
  outputSec: number;
  clipIndex: number;
  clipOffsetSec: number;
};

export function locateInSequence(
  clips: TimelineSequenceClip[],
  outputSec: number
): SequencePlayhead {
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const dur = clipDuration(clips[i]);
    if (outputSec <= cursor + dur + 1e-6) {
      return {
        outputSec,
        clipIndex: i,
        clipOffsetSec: Math.max(0, outputSec - cursor),
      };
    }
    cursor += dur;
  }
  const last = Math.max(0, clips.length - 1);
  const lastDur = clips.length ? clipDuration(clips[last]) : 0;
  return {
    outputSec,
    clipIndex: last,
    clipOffsetSec: lastDur,
  };
}

export function sourceTimeForOutput(
  clips: TimelineSequenceClip[],
  outputSec: number
): number {
  const loc = locateInSequence(clips, outputSec);
  const clip = clips[loc.clipIndex];
  if (!clip) return 0;
  return clip.source_start_sec + loc.clipOffsetSec;
}

export function formatClipRange(clip: TimelineSequenceClip): string {
  return `${formatTimelineTime(clip.source_start_sec)}–${formatTimelineTime(clip.source_end_sec)}`;
}
