import type { SlidePlan, TranscriptSegment } from "./types";

/** Prefer ffprobe duration; fall back to transcript segment ends when probe fails (some containers). */
export function effectiveDurationSec(
  probedSec: number,
  segments: TranscriptSegment[]
): number {
  let fromSeg = 0;
  for (const s of segments) {
    fromSeg = Math.max(fromSeg, s.startSec, s.endSec);
  }
  return Math.max(0.1, probedSec, fromSeg);
}

/** Spread slide times across the video when evidence timing is missing or degenerate. */
export function distributedTimestamp(
  slideIndex: number,
  totalSlides: number,
  durationSec: number
): number {
  const dur = Math.max(0.2, durationSec);
  if (totalSlides <= 0) return 0.05 * dur;
  const t = dur * (0.05 + 0.9 * (slideIndex + 0.5) / totalSlides);
  return clamp(t, 0.05 * dur, dur - 0.05);
}

function clamp(x: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(x, lo), hi);
}

/** Minimal slide shape for timestamping (carousel passes full {@link SlidePlan}). */
export type SlideEvidenceForTime = Pick<SlidePlan, "evidenceSegmentIds">;

export function slideTimestampSec(
  slide: SlideEvidenceForTime,
  segments: TranscriptSegment[],
  durationSec: number,
  slideIndex: number,
  totalSlides: number
): number {
  const dur = Math.max(0.2, durationSec);
  // One transcript block cannot supply distinct visuals per slide  -  spread across the timeline.
  if (segments.length === 1 && totalSlides > 1) {
    return distributedTimestamp(slideIndex, totalSlides, dur);
  }

  const ids = slide.evidenceSegmentIds ?? [];
  const segs = ids
    .map((id) => segments[id])
    .filter((s): s is TranscriptSegment => Boolean(s));

  if (segs.length === 0) {
    return distributedTimestamp(slideIndex, totalSlides, dur);
  }

  const start = segs[0].startSec;
  const end = segs[segs.length - 1].endSec;
  const mid = (start + end) / 2;

  const degenerate =
    !Number.isFinite(mid) ||
    mid <= 0.03 ||
    (Math.abs(end - start) < 0.02 && end <= 0.05);

  if (degenerate) {
    return distributedTimestamp(slideIndex, totalSlides, dur);
  }

  const maxT = dur - 0.05;
  return clamp(mid, 0.05, maxT);
}
