/**
 * Persists short “model vs your edit” notes in localStorage so future LLM runs
 * (carousel + image post) can see them via merged copyContext.
 */

import { MAX_COPY_CONTEXT_CHARS } from "@/lib/copy-context";

export const LEARNED_FROM_EDITS_STORAGE_KEY = "v2c-learned-from-edits-v1";
/** Rolling log size; oldest content is dropped from the front when over budget. */
export const MAX_LEARNED_STORE_CHARS = 12_000;

const MERGE_HEADER =
  "\n\n=== Preferences from your past manual edits (auto-captured) ===\n";

export type SlideTextBaseline = {
  order: number;
  headline: string;
  body: string;
};

export type ImagePostTextSnapshot = {
  hook: string;
  microCta: string;
  caption: string;
};

export function getLearnedFromEditsBlob(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(LEARNED_FROM_EDITS_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function clearLearnedFromEdits(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEARNED_FROM_EDITS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function truncateForLine(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Append dated lines to the rolling log. Skips a line if it is already the
 * suffix of the log (avoids double-append on strict-mode double-invoke).
 */
export function appendLearnedFromEditsLines(lines: string[]): void {
  if (typeof window === "undefined" || lines.length === 0) return;
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    let cur = getLearnedFromEditsBlob();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = `[${stamp}] ${trimmed}`;
      if (cur.endsWith(entry)) continue;
      cur = cur ? `${cur}\n${entry}` : entry;
      if (cur.length > MAX_LEARNED_STORE_CHARS) {
        cur = cur.slice(-MAX_LEARNED_STORE_CHARS);
      }
    }
    localStorage.setItem(LEARNED_FROM_EDITS_STORAGE_KEY, cur);
  } catch {
    // quota / private mode
  }
}

export function cloneSlidesForLearningBaseline(
  slides: { headline: string; body?: string; order: number }[]
): SlideTextBaseline[] {
  return slides.map((s) => ({
    order: s.order,
    headline: s.headline,
    body: s.body ?? "",
  }));
}

export function buildCarouselLearningLines(
  baseline: SlideTextBaseline[] | null,
  current: { headline: string; body?: string; order: number }[]
): string[] {
  if (!baseline || baseline.length === 0 || current.length === 0) return [];
  const lines: string[] = [];
  const n = Math.min(baseline.length, current.length);
  for (let i = 0; i < n; i++) {
    const b = baseline[i];
    const c = current[i];
    const bh = (b.headline ?? "").trim();
    const ch = (c.headline ?? "").trim();
    const bb = (b.body ?? "").trim();
    const cb = (c.body ?? "").trim();
    if (bh !== ch) {
      lines.push(
        `Carousel slide ${i + 1} headline — earlier: "${truncateForLine(bh, 100)}"; you edited to: "${truncateForLine(ch, 100)}". Prefer your wording for similar ideas.`
      );
    }
    if (bb !== cb) {
      lines.push(
        `Carousel slide ${i + 1} body — earlier: "${truncateForLine(bb, 100)}"; you edited to: "${truncateForLine(cb, 100)}". Prefer your wording for similar ideas.`
      );
    }
  }
  return lines;
}

export function buildImagePostLearningLines(
  prev: ImagePostTextSnapshot,
  next: ImagePostTextSnapshot
): string[] {
  const lines: string[] = [];
  if (prev.hook.trim() !== next.hook.trim()) {
    lines.push(
      `Image post hook — earlier: "${truncateForLine(prev.hook, 120)}"; you set: "${truncateForLine(next.hook, 120)}".`
    );
  }
  if (prev.microCta.trim() !== next.microCta.trim()) {
    lines.push(
      `Image post subline — earlier: "${truncateForLine(prev.microCta, 120)}"; you set: "${truncateForLine(next.microCta, 120)}".`
    );
  }
  if (prev.caption.trim() !== next.caption.trim()) {
    lines.push(
      `Image post caption — earlier: "${truncateForLine(prev.caption, 120)}"; you set: "${truncateForLine(next.caption, 120)}".`
    );
  }
  return lines;
}

/**
 * Merges Settings “context for copy” with the auto-captured log for API
 * `copyContext`. Respects {@link MAX_COPY_CONTEXT_CHARS} total.
 */
export function mergeCopyContextWithLearnings(
  userCopyContext: string | undefined,
  learnedBlob: string | undefined,
  maxTotal: number = MAX_COPY_CONTEXT_CHARS
): string | undefined {
  const u = (userCopyContext ?? "").trim();
  const L = (learnedBlob ?? "").trim();
  if (!u && !L) return undefined;
  if (!L) return u || undefined;
  if (!u) {
    const solo = `${MERGE_HEADER}${L}`;
    return solo.slice(0, maxTotal) || undefined;
  }
  const suffix = `${MERGE_HEADER}${L}`;
  const combined = `${u}${suffix}`;
  if (combined.length <= maxTotal) return combined;
  const learnedBudget = Math.min(L.length, Math.floor(maxTotal * 0.4));
  const learnedTail = L.slice(-Math.max(0, learnedBudget));
  const suffixShort = `${MERGE_HEADER}${learnedTail}`;
  const userBudget = maxTotal - suffixShort.length;
  if (userBudget < 120) {
    return suffixShort.slice(0, maxTotal);
  }
  return `${u.slice(0, userBudget)}${suffixShort}`;
}
