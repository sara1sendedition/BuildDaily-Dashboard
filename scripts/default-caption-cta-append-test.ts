/**
 * Regression checks for appendDefaultCaptionCtaBeforeHashtags (suffix / duplicate edge cases).
 *
 * Usage (from repo root):
 *   npm run test:default-caption-cta-append
 */

import { appendDefaultCaptionCtaBeforeHashtags } from "../lib/default-caption-cta";

let failures = 0;

function assertEqual(name: string, actual: string, expected: string): void {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL: ${name}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// Regression: CTA must not be skipped just because it is a suffix of the last word (old `endsWith(cta)` bug).
assertEqual(
  "suffix of last word still appends CTA",
  appendDefaultCaptionCtaBeforeHashtags("Climb with us", "us"),
  "Climb with us\n\nus"
);

// True duplicate: already inserted with our paragraph break — do not add again.
assertEqual(
  "skip when body already ends with newline block + CTA",
  appendDefaultCaptionCtaBeforeHashtags("Hook\n\nLink in bio", "Link in bio"),
  "Hook\n\nLink in bio"
);

// Same, with hashtag block after (reconstruct tags).
assertEqual(
  "skip duplicate before hashtags",
  appendDefaultCaptionCtaBeforeHashtags(
    "Body line\n\nLink in bio\n\n#climbing #bouldering",
    "Link in bio"
  ),
  "Body line\n\nLink in bio\n\n#climbing #bouldering"
);

assertEqual(
  "insert CTA before trailing hashtag-only lines",
  appendDefaultCaptionCtaBeforeHashtags(
    "First line\nSecond line\n\n#rockclimbing #training",
    "Save this for your next session."
  ),
  "First line\nSecond line\n\nSave this for your next session.\n\n#rockclimbing #training"
);

assertEqual(
  "empty CTA returns caption unchanged",
  appendDefaultCaptionCtaBeforeHashtags("Only body\n\n#tag", "   "),
  "Only body\n\n#tag"
);

assertEqual(
  "caption-only hashtags + CTA",
  appendDefaultCaptionCtaBeforeHashtags("#a #b\n#c", "Follow for more"),
  "Follow for more\n\n#a #b\n#c"
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}

console.log("default-caption-cta-append: all checks passed.");
