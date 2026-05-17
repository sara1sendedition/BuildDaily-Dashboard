import type { SlidePlan, TranscriptSegment } from "./types";

/** If every slide points at the same evidence (or none), spread segment indices so keyframes differ. */
export function normalizeSlidesForKeyframes(
  slides: SlidePlan[],
  segments: TranscriptSegment[]
): SlidePlan[] {
  const n = segments.length;
  if (slides.length === 0 || n === 0) return slides;

  const key = (s: SlidePlan) => JSON.stringify(s.evidenceSegmentIds ?? []);
  const firstKey = key(slides[0]);
  const allSameEvidence =
    slides.length > 1 && slides.every((s) => key(s) === firstKey);

  return slides.map((slide, i) => {
    let ids = (slide.evidenceSegmentIds ?? []).filter(
      (id) => Number.isInteger(id) && id >= 0 && id < n
    );

    if (ids.length === 0 || allSameEvidence) {
      const segIdx =
        n === 1
          ? 0
          : Math.min(
              n - 1,
              Math.round(((i + 0.5) / slides.length) * (n - 1))
            );
      ids = [segIdx];
    }

    return { ...slide, evidenceSegmentIds: ids };
  });
}
