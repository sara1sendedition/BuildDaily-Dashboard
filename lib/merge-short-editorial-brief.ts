/**
 * Builds the creator brief string for Video to Short `editorial_notes` from
 * stitch clip instructions, home editorial notes, and studio carousel focus.
 * De-duplicates segments that differ only by whitespace or letter case.
 */

import { MAX_CAROUSEL_FOCUS_CHARS } from "@/lib/carousel-focus";

/** Collapses whitespace (including newlines) and lowercases for comparison only. */
export function normalizeBriefTextForDedup(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export type MergeShortEditorialBriefInput = {
  /** Per-clip / stitch row instructions (trimmed by caller is fine). */
  clipInstructions: string;
  /** Home "Editorial notes for AI" from storage. */
  editorialNotes: string;
  /** Studio "carousel focus" run notes from storage. */
  studioCarouselNotes: string;
  /** Max length of the joined brief (typically MAX_CAROUSEL_FOCUS_CHARS). */
  maxChars: number;
};

/**
 * Concatenates non-empty parts in order: clip → editorial → studio carousel.
 * Skips a part when its dedup fingerprint matches an earlier part (whitespace
 * / case-insensitive).
 */
export function mergeShortEditorialBriefParts(
  input: MergeShortEditorialBriefInput
): string {
  const maxChars =
    typeof input.maxChars === "number" &&
    Number.isFinite(input.maxChars) &&
    input.maxChars > 0
      ? Math.floor(input.maxChars)
      : MAX_CAROUSEL_FOCUS_CHARS;

  const clip = String(input.clipInstructions ?? "").trim();
  const ed = String(input.editorialNotes ?? "").trim();
  const studio = String(input.studioCarouselNotes ?? "").trim();

  const parts: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (raw: string): void => {
    if (!raw) return;
    const fp = normalizeBriefTextForDedup(raw);
    if (!fp) return;
    if (seen.has(fp)) return;
    seen.add(fp);
    parts.push(raw.trim());
  };

  pushUnique(clip);
  pushUnique(ed);
  pushUnique(studio);

  return parts.join("\n\n---\n\n").slice(0, maxChars);
}
