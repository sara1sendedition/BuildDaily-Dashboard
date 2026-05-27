/**
 * Run: `npx tsx scripts/carousel-slide-limits-test.ts`
 */
import {
  FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS,
  splitFirstSlideHeadlineAtMax,
  truncateHeadlineAtWordBoundary,
} from "../lib/carousel-slide-limits";

let failures = 0;
function expect(condition: boolean, label: string): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

console.log("\n=== truncateHeadlineAtWordBoundary ===");
const long = "Reaching for your next hold?";
const trimmed = truncateHeadlineAtWordBoundary(
  long,
  FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS
);
expect(!trimmed.endsWith("ho"), "does not end mid-word 'ho'");
expect(trimmed === long, "28-char hook fits at 32-char cap without trimming");

console.log("\n=== splitFirstSlideHeadlineAtMax ===");
const split = splitFirstSlideHeadlineAtMax(
  "This is a deliberately long first slide hook headline",
  25
);
expect(split.headline.length <= 25, "headline respects cap");
expect(!split.headline.endsWith("head"), "word-boundary split avoids partial word");
expect(split.overflow.length > 0, "overflow captured for body merge");

process.exit(failures === 0 ? 0 : 1);
