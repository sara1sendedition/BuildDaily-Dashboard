/**
 * A/B comparison using a real video: transcribe once, classify once, then
 * generateSlides twice (without vs with copyContext). No full ZIP render.
 *
 * Usage (from repo root):
 *   npm run test:copy-context-ab-video
 *
 * Requires OPENAI_API_KEY and fixtures/IMG_5609.MOV (or set VIDEO_PATH).
 * Set USE_PINNED_TRANSCRIPT=1 to skip Whisper and use a fixed transcript (same input every run).
 * Set ONLY_WITH_COPY=1 to run generateSlides once with copyContext only (faster; check copy tweaks).
 */

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { extractAudioMp3, probeDurationSec } from "../lib/ffmpeg";
import { generateSlides, recommendCarouselType } from "../lib/llm";
import { transcribeWithTimestamps } from "../lib/transcribe";
import type { SlidePlan, TranscriptSegment } from "../lib/types";

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

const COPY_CONTEXT = [
  "Copywriting rules for this run:",
  "- Use British spelling (e.g. colour, centre).",
  "- Address the reader as 'climbers' at least once across the deck.",
  "- Do not use exclamation marks anywhere.",
  "- Keep a calm, coaching tone - no hype words like 'insane' or 'crush'.",
].join("\n");

/**
 * Pinned Whisper output for fixtures/IMG_5609.MOV so both slide passes share
 * the exact same transcript (set USE_PINNED_TRANSCRIPT=1 to skip re-transcribing).
 */
const PINNED_IMG_5609_TRANSCRIPT: TranscriptSegment[] = [
  {
    id: 0,
    startSec: 0,
    endSec: 8.88,
    text: "Throwing for a move every once in a while is okay, but if you find yourself throwing",
  },
  {
    id: 1,
    startSec: 8.88,
    endSec: 14.24,
    text: "for every single move, you're probably wasting energy and you could practice a little bit",
  },
  {
    id: 2,
    startSec: 14.24,
    endSec: 19.64,
    text: "more straight arms, using your hips and your core to move your body into positions more",
  },
  { id: 3, startSec: 19.64, endSec: 20.88, text: "statically." },
  {
    id: 4,
    startSec: 20.88,
    endSec: 28.4,
    text: "We're not trying to go slow all the time, we're trying to create flow while staying",
  },
  { id: 5, startSec: 28.44, endSec: 29.44, text: "in control." },
  { id: 6, startSec: 29.44, endSec: 31.44, text: "Good?" },
];

function formatSlides(label: string, slides: SlidePlan[]) {
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

  if (
    process.env.USE_STUB_LLM === "true" ||
    process.env.USE_STUB_LLM === "1"
  ) {
    console.error(
      "USE_STUB_LLM is set; this test needs a real LLM. Unset it."
    );
    process.exit(1);
  }

  const usePinned =
    process.env.USE_PINNED_TRANSCRIPT === "1" ||
    process.env.USE_PINNED_TRANSCRIPT === "true";

  const onlyWithCopy =
    process.env.ONLY_WITH_COPY === "1" ||
    process.env.ONLY_WITH_COPY === "true";

  const videoPath =
    process.env.VIDEO_PATH?.trim() ||
    path.join(process.cwd(), "fixtures", "IMG_5609.MOV");

  if (!usePinned && !fs.existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`);
    console.error(
      "Add fixtures/IMG_5609.MOV or set VIDEO_PATH to an absolute path."
    );
    process.exit(1);
  }

  console.log(
    onlyWithCopy
      ? "Copy context  -  sample video (with copyContext only)\n"
      : "Copy context A/B  -  sample video (transcribe once, two generateSlides passes)\n"
  );
  if (usePinned) {
    console.log("Mode: USE_PINNED_TRANSCRIPT (fixed IMG_5609 Whisper segments)");
  } else {
    console.log("Video:", videoPath);
  }
  if (onlyWithCopy) {
    console.log("Mode: ONLY_WITH_COPY (single generateSlides with copyContext)\n");
  }
  console.log(
    onlyWithCopy
      ? "Temperature: 0\n"
      : "Temperature: 0 for both slide passes\n"
  );

  const workDir = path.join(tmpdir(), `v2c-ab-${randomUUID()}`);
  await fsPromises.mkdir(workDir, { recursive: true });

  let transcript: TranscriptSegment[];
  try {
    if (usePinned) {
      transcript = PINNED_IMG_5609_TRANSCRIPT.map((s, i) => ({ ...s, id: i }));
      console.log(
        `Transcript: ${transcript.length} segments (pinned, no Whisper)\n`
      );
    } else {
      const durationSec = await probeDurationSec(videoPath);
      const audioPath = await extractAudioMp3(videoPath, workDir);
      transcript = await transcribeWithTimestamps(
        audioPath,
        apiKey,
        durationSec
      );
      transcript.forEach((s, i) => {
        s.id = i;
      });

      console.log(`Transcript: ${transcript.length} segments (Whisper)\n`);
    }

    const recommendation = await recommendCarouselType(
      transcript,
      undefined,
      undefined,
      apiKey,
      {}
    );
    const effectiveType = recommendation.recommendedType;

    console.log(
      `Recommended type: ${effectiveType} (${recommendation.confidence} confidence)\n`
    );

    if (onlyWithCopy) {
      const slidesWith = await generateSlides(
        transcript,
        effectiveType,
        undefined,
        undefined,
        apiKey,
        { temperature: 0, copyContext: COPY_CONTEXT }
      );
      formatSlides("WITH copy settings (copyContext)", slidesWith);
    } else {
      const slidesWithout = await generateSlides(
        transcript,
        effectiveType,
        undefined,
        undefined,
        apiKey,
        { temperature: 0 }
      );

      const slidesWith = await generateSlides(
        transcript,
        effectiveType,
        undefined,
        undefined,
        apiKey,
        { temperature: 0, copyContext: COPY_CONTEXT }
      );

      formatSlides(
        "WITHOUT copy settings (no copyContext)",
        slidesWithout
      );
      formatSlides("WITH copy settings (copyContext)", slidesWith);

      const a = slidesWithout.map((s) => s.headline + (s.body ?? "")).join("|");
      const b = slidesWith.map((s) => s.headline + (s.body ?? "")).join("|");
      if (a === b) {
        console.log(
          "Note: Slide text identical between runs (unusual); try again or tweak COPY_CONTEXT.\n"
        );
      } else {
        console.log("Outputs differ between without and with copy context.\n");
      }
    }
  } finally {
    await fsPromises.rm(workDir, { recursive: true, force: true }).catch(
      () => undefined
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
