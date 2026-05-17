/**
 * Sanity test for lib/validate-slides.ts.
 *
 * Run: `npx tsx scripts/validate-slides-test.ts`
 *
 * Uses the actual "Using your legs?" carousel that prompted the validator work as a
 * known-bad fixture; confirms each rule fires where expected and that a known-good
 * carousel passes cleanly.
 */
import { validateSlides } from "../lib/validate-slides";
import type { SlidePlan } from "../lib/types";

let failures = 0;
function expect(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

function header(s: string): void {
  console.log(`\n=== ${s} ===`);
}

// ---------- BAD: the actual "Using your legs?" carousel ----------
header("Known-bad: 'Using your legs?' (the carousel that triggered this work)");
const usingYourLegs: SlidePlan[] = [
  {
    order: 1,
    role: "hook",
    headline: "Using your legs?",
    body: "If your new climber struggles with this advice, it might be why.",
    evidenceSegmentIds: [0],
  },
  {
    order: 2,
    role: "body",
    headline: "Misleading advice",
    body: "Telling them to use their legs without context can confuse them.",
    evidenceSegmentIds: [1],
  },
  {
    order: 3,
    role: "body",
    headline: "Common mistake",
    body: "Focusing too much on legs often leads to losing hand and arm connection.",
    evidenceSegmentIds: [2],
  },
  {
    order: 4,
    role: "body",
    headline: "What's really happening?",
    body: "They're often pulling too hard with arms, using 'dinosaur arms' instead of straightening up.",
    evidenceSegmentIds: [3],
  },
  {
    order: 5,
    role: "body",
    headline: "What to try",
    body: "Encourage them to move around the hold, not just pull towards the chest.",
    evidenceSegmentIds: [4],
  },
];
const r1 = validateSlides(usingYourLegs);
console.log(`  errors: ${r1.errors.length}`);
for (const e of r1.errors) {
  console.log(`    [${e.rule}] slide ${e.slideOrder} ${e.field}: ${e.detail.split("\n")[0].slice(0, 120)}…`);
}
expect(!r1.ok, "validator rejects this carousel overall");
expect(
  r1.errors.some((e) => e.rule === "tease_body" && e.slideOrder === 1),
  "tease_body fires on slide 1 ('it might be why')"
);
expect(
  r1.errors.some((e) => e.rule === "no_correction_floor"),
  "no_correction_floor fires (only 1 of 5 slides has a corrective verb — slide 5 'move')"
);

// ---------- BAD: vague phrase headline ----------
header("Known-bad: vague phrase headline");
const vague: SlidePlan[] = [
  {
    order: 1,
    headline: "Use your core",
    body: "It's the secret to better climbing.",
    evidenceSegmentIds: [0],
  },
  {
    order: 2,
    headline: "Stay in control",
    body: "Press through your toes and trust the foothold.",
    evidenceSegmentIds: [1],
  },
];
const r2 = validateSlides(vague);
console.log(`  errors: ${r2.errors.length}`);
for (const e of r2.errors) {
  console.log(`    [${e.rule}] slide ${e.slideOrder} ${e.field}`);
}
expect(
  r2.errors.some((e) => e.rule === "vague_phrase" && /core/.test(e.detail)),
  "vague_phrase fires on 'use your core'"
);
expect(
  r2.errors.some((e) => e.rule === "vague_phrase" && /control/.test(e.detail)),
  "vague_phrase fires on 'stay in control'"
);
expect(
  !r2.errors.some((e) => e.rule === "no_correction_floor"),
  "no_correction_floor does NOT fire on a 2-slide carousel (floor only applies to 4+)"
);

// ---------- BAD: duplicate slides ----------
header("Known-bad: duplicate-idea slides");
const dupes: SlidePlan[] = [
  {
    order: 1,
    headline: "Place your foot quietly",
    body: "Set the toe gently before transferring weight.",
    evidenceSegmentIds: [0],
  },
  {
    order: 2,
    headline: "Shift weight to the higher foothold",
    body: "Drive through the leg before reaching.",
    evidenceSegmentIds: [1],
  },
  {
    order: 3,
    headline: "Place that foot quietly",
    body: "Set the toe gently before you transfer weight.",
    evidenceSegmentIds: [2],
  },
  {
    order: 4,
    headline: "Anchor your hips",
    body: "Bring the hip over the foot before extending.",
    evidenceSegmentIds: [3],
  },
];
const r3 = validateSlides(dupes);
console.log(`  errors: ${r3.errors.length}`);
for (const e of r3.errors) {
  console.log(`    [${e.rule}] slide ${e.slideOrder} ${e.field}`);
}
expect(
  r3.errors.some((e) => e.rule === "duplicate_slide" && e.slideOrder === 3),
  "duplicate_slide fires on slide 3 (near-identical to slide 1)"
);

// ---------- GOOD: a clean rewrite of the legs carousel ----------
header("Known-good: clean rewrite delivering the actual technique");
const cleanRewrite: SlidePlan[] = [
  {
    order: 1,
    role: "hook",
    headline: "Arms tire before legs?",
    body: "You might be pulling through holds instead of moving around them.",
    evidenceSegmentIds: [0],
  },
  {
    order: 2,
    role: "step",
    headline: "Step 1: Straighten your arms",
    body: "Hang from straight arms before each move so your skeleton holds you up, not your biceps.",
    evidenceSegmentIds: [1],
  },
  {
    order: 3,
    role: "step",
    headline: "Step 2: Shift your hips around the hold",
    body: "Twist a hip toward the wall and step the outside foot through. The hold stays still; your body moves around it.",
    evidenceSegmentIds: [2],
  },
  {
    order: 4,
    role: "step",
    headline: "Step 3: Now your legs do the work",
    body: "Press up through the foot under your hip; the arm just guides you, it does not pull.",
    evidenceSegmentIds: [3],
  },
  {
    order: 5,
    role: "body",
    headline: "Quick check",
    body: "If your forearms blow up two routes in, you skipped Step 1. Reset to straight arms before the next attempt.",
    evidenceSegmentIds: [4],
  },
];
const r4 = validateSlides(cleanRewrite);
console.log(`  errors: ${r4.errors.length}`);
for (const e of r4.errors) {
  console.log(`    [${e.rule}] slide ${e.slideOrder} ${e.field}: ${e.detail.split("\n")[0].slice(0, 120)}…`);
}
expect(r4.ok, "validator passes the clean rewrite (zero errors)");

// ---------- summary ----------
console.log("");
if (failures === 0) {
  console.log(`OK — all assertions passed.`);
  process.exit(0);
} else {
  console.error(`FAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}
