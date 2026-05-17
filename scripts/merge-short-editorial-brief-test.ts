import assert from "node:assert/strict";
import {
  mergeShortEditorialBriefParts,
  normalizeBriefTextForDedup,
} from "../lib/merge-short-editorial-brief";

function sep(): string {
  return "\n\n---\n\n";
}

assert.equal(normalizeBriefTextForDedup("  A\n\nB\tc"), "a b c");

let out = mergeShortEditorialBriefParts({
  clipInstructions: "",
  editorialNotes: "",
  studioCarouselNotes: "  only studio  ",
  maxChars: 100,
});
assert.equal(out, "only studio");

out = mergeShortEditorialBriefParts({
  clipInstructions: "first",
  editorialNotes: "second",
  studioCarouselNotes: "third",
  maxChars: 500,
});
assert.equal(out, `first${sep()}second${sep()}third`);

out = mergeShortEditorialBriefParts({
  clipInstructions: "Same text",
  editorialNotes: "same\n\ntext",
  studioCarouselNotes: "unique tail",
  maxChars: 500,
});
assert.equal(out, `Same text${sep()}unique tail`);

out = mergeShortEditorialBriefParts({
  clipInstructions: "a",
  editorialNotes: "",
  studioCarouselNotes: "A",
  maxChars: 500,
});
assert.equal(out, "a");

out = mergeShortEditorialBriefParts({
  clipInstructions: "x".repeat(20),
  editorialNotes: "",
  studioCarouselNotes: "y",
  maxChars: 10,
});
assert.equal(out.length, 10);
assert.ok(out.startsWith("xxxxxxxxxx"));

console.log("merge-short-editorial-brief tests passed");
