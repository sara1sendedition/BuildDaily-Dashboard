/** First slide hook/headline as rendered on the lead carousel image (PNG overlay). */
export const FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS = 32;

/** Index of the opening slide (minimum `order`, ties by array index). */
export function firstCarouselSlideIndex(
  slides: { order?: number }[]
): number {
  if (slides.length === 0) return 0;
  return slides
    .map((s, i) => ({
      i,
      order:
        typeof s.order === "number" && Number.isFinite(s.order) ? s.order : Infinity,
    }))
    .sort((a, b) => a.order - b.order || a.i - b.i)[0]!.i;
}

/** Truncate at a word boundary when possible so export never shows cut-off words. */
export function truncateHeadlineAtWordBoundary(
  text: string,
  maxChars: number
): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxChars * 0.55)) {
    return slice.slice(0, lastSpace).trimEnd();
  }
  return slice.trimEnd();
}

/**
 * Cap slide-1 headline length; return overflow text to merge into `body` when trimming.
 */
export function splitFirstSlideHeadlineAtMax(
  headline: string,
  maxChars: number = FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS
): { headline: string; overflow: string } {
  const t = headline.trim();
  if (t.length <= maxChars) return { headline: t, overflow: "" };
  const kept = truncateHeadlineAtWordBoundary(t, maxChars);
  const overflow = t.slice(kept.length).trim();
  return { headline: kept, overflow };
}
