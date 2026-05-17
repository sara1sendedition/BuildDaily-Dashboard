/**
 * A/B comparison: same transcript (same "video" content for slide copy) with vs without
 * copywriting context passed to generateSlides.
 *
 * Usage (from repo root):
 *   npm run test:copy-context-ab
 *
 * Requires OPENAI_API_KEY (env or .env / .env.local).
 */

import * as fs from "fs";
import * as path from "path";
import { generateSlides } from "../lib/llm";
import type { TranscriptSegment } from "../lib/types";

function loadOpenAiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return process.env.OPENAI_API_KEY.trim();
  }
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)$/);
      if (m) {
        return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
}

/** Fixed transcript  -  same as title-hook-impact (climbing / foot / hip). */
const SAME_VIDEO_TRANSCRIPT: TranscriptSegment[] = [
  {
    id: 0,
    text: "Everyone blames their shoes when they slip on tiny footholds, but it is rarely the rubber.",
    startSec: 0,
    endSec: 5,
  },
  {
    id: 1,
    text: "What actually matters is where your hips are and how much weight you commit through the toe.",
    startSec: 5,
    endSec: 12,
  },
  {
    id: 2,
    text: "If your hip stays too far out, you cannot press down through the foot and you will skate off.",
    startSec: 12,
    endSec: 20,
  },
  {
    id: 3,
    text: "Bring the hip in, stack over the foot, and suddenly those smears feel sticky again.",
    startSec: 20,
    endSec: 28,
  },
];

const CAROUSEL_TYPE = "belief_shifting" as const;
const TITLE = "Feet slip on small holds? It is not your shoes";
const HINT = undefined;

/** Deliberately strong so outputs are likely to diverge from the no-context run. */
const COPY_CONTEXT = [
  "Copywriting rules for this run:",
  "- Use British spelling (e.g. colour, centre).",
  "- Address the reader as 'climbers' at least once across the deck.",
  "- Do not use exclamation marks anywhere.",
  "- Keep a calm, coaching tone - no hype words like 'insane' or 'crush'.",
].join("\n");

function formatSlides(label: string, slides: Awaited<ReturnType<typeof generateSlides>>) {
  console.log(`\n--- ${label} ---\n`);
  for (const s of slides) {
    const body = s.body ? ` | body: ${s.body}` : "";
    console.log(`  ${s.order}. ${s.headline}${body}`);
  }
  console.log("");
}

async function main() {
  const apiKey = loadOpenAiKey();
  if (!apiKey) {
    console.error(
      "Missing OPENAI_API_KEY. Set it in the environment or .env / .env.local"
    );
    process.exit(1);
  }

  console.log(
    "Copy context A/B test  -  same transcript as one processed video; two LLM calls (with / without context).\n"
  );
  console.log("Carousel type:", CAROUSEL_TYPE);
  console.log("Title:", TITLE);
  console.log("Temperature: 0 (for stability)\n");

  const optsBase = { temperature: 0 as const };

  const without = await generateSlides(
    SAME_VIDEO_TRANSCRIPT,
    CAROUSEL_TYPE,
    TITLE,
    HINT,
    apiKey,
    optsBase
  );

  const withContext = await generateSlides(
    SAME_VIDEO_TRANSCRIPT,
    CAROUSEL_TYPE,
    TITLE,
    HINT,
    apiKey,
    { ...optsBase, copyContext: COPY_CONTEXT }
  );

  formatSlides("WITHOUT copy settings (no copyContext)", without);
  formatSlides("WITH copy settings (copyContext)", withContext);

  const a = without.map((s) => s.headline + (s.body ?? "")).join("|");
  const b = withContext.map((s) => s.headline + (s.body ?? "")).join("|");
  if (a === b) {
    console.log(
      "Note: Outputs were identical this run. The model may still diverge on other runs; try editing COPY_CONTEXT in this script.\n"
    );
  } else {
    console.log("Outputs differ between the two runs (as expected when context steers copy).\n");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
