/**
 * Compares first-slide hooks when only the optional "title" field changes
 * (same transcript, carousel type, temperature 0 for stability).
 *
 * Usage (from repo root):
 *   npx tsx scripts/title-hook-impact.ts
 *
 * Requires OPENAI_API_KEY in the environment or in .env / .env.local
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

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Fixed transcript: foot / hip / friction  -  title can align or mislead. */
const SAMPLE: TranscriptSegment[] = [
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

const CASES: { label: string; title: string | undefined }[] = [
  { label: "No title (same as empty field)", title: undefined },
  { label: "Misleading (wrong topic)", title: "Perfect sourdough crust at home" },
  { label: "Aligned (matches content)", title: "Feet slip on small holds? It is not your shoes" },
  { label: "Vague (same domain)", title: "Climbing technique tips" },
];

async function main() {
  const apiKey = loadOpenAiKey();
  if (!apiKey) {
    console.error(
      "Missing OPENAI_API_KEY. Set it in the environment or .env / .env.local"
    );
    process.exit(1);
  }

  const carouselType = "belief_shifting" as const;
  const hint = undefined;

  console.log("Model: gpt-4o-mini, temperature: 0, carousel:", carouselType);
  console.log("Transcript: 4 segments (~28s), climbing / foot / hip theme.\n");

  const hooks: { label: string; title: string; headline: string; body: string }[] =
    [];

  for (const { label, title } of CASES) {
    const slides = await generateSlides(
      SAMPLE,
      carouselType,
      title,
      hint,
      apiKey,
      { temperature: 0 }
    );
    const first = slides[0];
    const headline = first?.headline ?? "(no slide)";
    const body = first?.body ?? "";
    hooks.push({
      label,
      title: title ?? "(none)",
      headline,
      body,
    });
    console.log(" - ", label);
    console.log("  Title sent:", title ?? "(none)");
    console.log("  Hook headline:", headline);
    if (body) console.log("  Hook body:", body);
    console.log("");
  }

  const headlines = hooks.map((h) => h.headline);
  const bodies = hooks.map((h) => h.body.trim());
  const unique = new Set(headlines);
  const uniqueBodies = new Set(bodies);
  console.log("--- Summary ---");
  console.log("Distinct first-slide headlines:", unique.size, "/", headlines.length);
  console.log(
    "Distinct first-slide bodies (empty counts as one):",
    uniqueBodies.size,
    "/",
    bodies.length
  );

  let minJ = 1;
  let maxJ = 0;
  for (let i = 0; i < headlines.length; i++) {
    for (let j = i + 1; j < headlines.length; j++) {
      const jacc = jaccard(headlines[i], headlines[j]);
      minJ = Math.min(minJ, jacc);
      maxJ = Math.max(maxJ, jacc);
    }
  }
  console.log(
    "Pairwise headline word overlap (Jaccard, words > 2 chars): min",
    minJ.toFixed(2),
    "max",
    maxJ.toFixed(2)
  );

  if (unique.size === 1 && uniqueBodies.size === 1) {
    console.log(
      "\nInterpretation: Same headline and body at temp 0 → title had no effect on slide 1 copy in this run."
    );
  } else if (unique.size === 1) {
    console.log(
      "\nInterpretation: Same hook headline, but body text varied  -  title may nudge supporting line only."
    );
  } else if (unique.size === headlines.length) {
    console.log(
      "\nInterpretation: Every title produced a different hook → title meaningfully steers the model here."
    );
  } else {
    console.log(
      "\nInterpretation: Some variation  -  compare rows above to see which titles differ (e.g. misleading vs aligned)."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
