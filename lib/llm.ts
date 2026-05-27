import OpenAI from "openai";
import {
  FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS,
  firstCarouselSlideIndex,
  splitFirstSlideHeadlineAtMax,
} from "./carousel-slide-limits";
import { FIRST_SLIDE_HOOK_COPY_APPENDIX } from "./first-slide-hook-copy";
import type {
  CarouselRecommendation,
  CarouselType,
  SlidePlan,
  TranscriptSegment,
} from "./types";
import { HOOK_VOICE_APPENDIX } from "./hook-voice";
import { stripEmDashes } from "./strip-em-dash";

const CAROUSEL_TYPES: CarouselType[] = [
  "example_breakdown",
  "listical",
  "step_by_step",
  "belief_shifting",
];

function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s, i) => `[${i}] ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s: ${s.text}`).join("\n");
}

export type CarouselLlmContextOptions = {
  copyContext?: string;
  /** Serialized visual reference (carousel / photo); steers format + tone. */
  visualReferencePrompt?: string;
  /** Optional angle for this generation (e.g. emphasize cause/effect); transcript stays ground truth. */
  carouselFocus?: string;
};

function carouselFocusBlock(focus: string | undefined): string {
  const f = focus?.trim();
  if (!f) return "";
  return `\nPRIMARY CREATIVE BRIEF — Carousel focus (follow this before mirroring transcript phrasing or default coaching tropes):\n${f}\n\nHow to combine with the transcript:\n- Hook and carousel arc must serve this brief first (same reader question, tension, or promise).\n- **Preserve the brief's idea order.** Whatever problem, symptom, or scenario appears *first* in the brief must appear *first* in slide 1's hook headline (e.g. if the brief leads with feet slipping and later names hip position, the hook must foreground feet slipping—not hips, not a transcript-first phrase). Do not invert or reorder the brief's sequence to match how the coach spoke unless the brief itself does.\n- Transcript segments are the **fact** source: every slide still needs evidenceSegmentIds that genuinely support the slide; do not invent actions or dialogue.\n- Choose and emphasize transcript moments that **explain or justify** this brief. If the brief names a symptom or scenario (e.g. feet slipping) and the clip stresses a related mechanism (e.g. hip position), chain them clearly across slides in an order that **still respects the brief's sequence** (symptom before mechanism when the brief does).\n- Reframing **how** you open and title beats is expected when it matches this brief; literal transcript wording is not required for the hook if facts stay honest.\n`;
}

/** Extra system rules when carousel focus is present (slides). */
const GENERATE_SLIDES_CAROUSEL_FOCUS_APPENDIX = `

Carousel focus mode (the user message contains PRIMARY CREATIVE BRIEF — Carousel focus):
- That brief is PRIMARY for hook wording, slide sequence, and reader-facing problem framing. It outranks echoing the transcript's dominant phrase if they differ.
- **Slide 1 headline order:** match the brief's **opening emphasis sequence**. The first concrete problem/symptom/question in the brief must lead the hook; do not open with a secondary mechanism or transcript-default angle when the brief already ordered ideas differently.
- Copywriting context is secondary to the Carousel focus when both appear.
- Transcript fidelity still means: no false claims, no invented mechanics or quotes; evidenceSegmentIds must support each slide.
- "Fidelity" does **not** mean the hook must repeat what the coach said first on mic if the brief specifies a different entry point—ground the teaching in transcript-backed content.
`.trimStart();

function generateSlidesSystemContent(
  typeGuide: string,
  hasCarouselFocus: boolean
): string {
  const base = `You write slide copy for social carousels exported at 1080×1080 (YouTube) and 1080×1350 (Instagram 4:5), same text on both (5–7 slides, max 10). Short lines; other slides: keep headlines tight (aim well under ~120 chars); the **first** slide hook has a stricter cap below.

Never use em dashes (Unicode U+2014) in any output. Use commas, periods, colons, or " - " (space-hyphen-space) instead.

When the user message includes a Copywriting context block, prefer it over the generic rules below for tone, wording, specificity, and how to spell out implied ideas, unless doing so would contradict the transcript or (when present) the PRIMARY CREATIVE BRIEF — Carousel focus.

When the user message includes a Visual reference block, treat it as the target aesthetic for hook style, punchiness, and slide pacing (still never contradict the transcript).

When the user message includes a PRIMARY CREATIVE BRIEF — Carousel focus section, treat it as the top priority for hooks and arc as described in the user message and in any Carousel focus mode rules below.

${HOOK_VOICE_APPENDIX}

Carousel structure for this type:
${typeGuide}

Return JSON only: {"slides":[{"order":1,"role":"hook|title|list_item|step|belief_old|belief_new|body|...","hookStyle":"shared_experience|gentle_reframe|patterns|guidance|realization|null","headline":"string","body":"string optional","evidenceSegmentIds":[0,1]}]}

Headline / body split:
- Headline = one short, punchy idea (single beat).
- Body = one supporting clarification, consequence, or cue (optional when the headline is enough on its own).
- Do not stuff explanation into the headline; keep headlines tight; body renders at larger size for supporting copy.
- If a slide needs two thoughts, put the second thought in the body, not the headline.

**Only the first carousel slide** (lowest \`order\`, usually \`1\`, often role \`hook\`) has a **hard headline length cap** for the first exported image:
- That **one** slide's \`headline\` MUST be **${FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS} characters or fewer** (count spaces and punctuation). **No other slide** has this limit—slides 2+ can use normal longer headlines (still keep them tight and readable).
- **Craft** this first hook to read naturally at that length. Do **not** write a long first headline expecting truncation—move overflow to \`body\` on that same slide.
- If you would otherwise exceed the cap, shorten the first slide's headline and put the rest in \`body\`.

${FIRST_SLIDE_HOOK_COPY_APPENDIX}

Transcript fidelity:
- Write only what is supported by the transcript.
- Do not invent mechanics, steps, or claims that are not shown or stated.
- Prefer slide copy grounded in real moments, corrections, or contrasts present in the source material.

No filler / no explanation-only slides:
- Each slide must either:
  - show a mistake
  - explain a cause → effect relationship
  - give a specific correction
  - or show a clear contrast
- Do not include slides that only explain, summarize, or describe the topic.
- Slides must feel like guidance or instruction, not explanation.

Do not produce redundant slides:
- Each slide must provide new information or a new step in the sequence.

Cause → Effect → Correction:
- At least one slide must clearly show:
  - what is happening (cause)
  - what goes wrong (effect)
  - what to change (correction)
- Prefer combining these into one tight, clear statement when possible.

Concrete language:
- Describe things using observable actions, behaviors, or outcomes.
- Avoid vague terms unless immediately clarified with something visible or testable.

Clarity rule:
- Avoid vague benefit statements (e.g. "this helps", "this improves things").
- Show exactly what changes or happens instead.

Rules:
- evidenceSegmentIds must reference segment indices from the transcript that support this slide.
- Use different segment indices for different slides when possible (chronological order for step-by-step), so each slide can use a different video moment.
- Include hookStyle on slides where hook voice applies (especially first slide and titles).
`.trim();
  return hasCarouselFocus ? `${base}\n${GENERATE_SLIDES_CAROUSEL_FOCUS_APPENDIX}` : base;
}

export async function recommendCarouselType(
  segments: TranscriptSegment[],
  title: string | undefined,
  hint: string | undefined,
  apiKey: string,
  opts?: CarouselLlmContextOptions
): Promise<CarouselRecommendation> {
  const openai = new OpenAI({ apiKey });
  const copy = opts?.copyContext?.trim();
  const vr = opts?.visualReferencePrompt?.trim();
  const cf = carouselFocusBlock(opts?.carouselFocus);
  const user = [
    `Video title: ${title ?? "(none)"}`,
    `Creator hint: ${hint ?? "(none)"}`,
    copy
      ? `\nCopywriting context (optional: may inform format choice; prefer creator rules below over generic defaults when choosing a type):\n${copy}\n`
      : "",
    vr
      ? `\nVisual reference (optional: match pacing and slide role mix to this aesthetic when it fits the transcript):\n${vr}\n`
      : "",
    cf,
    "\nTranscript segments:\n",
    transcriptText(segments),
  ].join("");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You classify which carousel format fits best for social slides.

Types:
- example_breakdown: movement/technique; before/after, good vs bad, frame-by-frame.
- listical: numbered patterns/mistakes; saves/shares; "5 mistakes", "3 things...".
- step_by_step: drills, sequences, how-to practice; ordered steps.
- belief_shifting: reframe beliefs; pattern interrupt; why common belief wrong; what's true; what to do.

Return JSON only: {"recommendedType":"string","confidence":"high"|"medium"|"low","rationale":"string","runnerUp":"string"|null}

When the user message includes PRIMARY CREATIVE BRIEF — Carousel focus, treat that brief as the strongest signal for format choice ahead of generic transcript shape (still pick a type the transcript can substantiate). Copywriting context is secondary to that brief.`,
      },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: {
    recommendedType?: string;
    confidence?: string;
    rationale?: string;
    runnerUp?: string | null;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return {
      recommendedType: "example_breakdown",
      confidence: "low" as const,
      rationale: "Could not parse model response.",
    };
  }
  const t = normalizeType(parsed.recommendedType);
  return {
    recommendedType: t,
    confidence:
      parsed.confidence === "high" || parsed.confidence === "low"
        ? parsed.confidence
        : "medium",
    rationale: stripEmDashes(parsed.rationale ?? ""),
    runnerUp: parsed.runnerUp ? normalizeType(parsed.runnerUp) : undefined,
  };
}

function normalizeType(s: string | undefined): CarouselType {
  const v = (s ?? "").toLowerCase().replace(/-/g, "_");
  if (CAROUSEL_TYPES.includes(v as CarouselType)) return v as CarouselType;
  return "example_breakdown";
}

/**
 * Model for slide generation.
 *
 * Override via `OPENAI_SLIDES_MODEL` env var when you want to swap to a stronger
 * model (e.g. `gpt-4o`) for slides only without affecting cheaper steps like
 * `recommendCarouselType` or `extract-carousel-style-vision`. Default keeps the
 * historical `gpt-4o-mini` behavior so unset envs are a no-op.
 */
function slidesModel(): string {
  const env = process.env.OPENAI_SLIDES_MODEL?.trim();
  return env && env.length > 0 ? env : "gpt-4o-mini";
}

export async function generateSlides(
  segments: TranscriptSegment[],
  carouselType: CarouselType,
  title: string | undefined,
  hint: string | undefined,
  apiKey: string,
  options?: {
    temperature?: number;
    copyContext?: string;
    visualReferencePrompt?: string;
    carouselFocus?: string;
    /**
     * Validator feedback from a prior failed attempt — injected as a clearly-labeled
     * block in the user message so the model can repair specific issues in this retry.
     * Distinct from copyContext (brand voice) and from carouselFocus (creative brief).
     */
    validatorFeedback?: string;
  }
): Promise<SlidePlan[]> {
  const openai = new OpenAI({ apiKey });
  const typeGuide = typePrompt(carouselType);
  const copy = options?.copyContext?.trim();
  const vr = options?.visualReferencePrompt?.trim();
  const cf = carouselFocusBlock(options?.carouselFocus);
  const vf = options?.validatorFeedback?.trim();
  const hasCarouselFocus = Boolean(options?.carouselFocus?.trim());
  const user = [
    `Video title: ${title ?? "(none)"}`,
    `Creator hint: ${hint ?? "(none)"}`,
    copy
      ? `\nCopywriting context (${hasCarouselFocus ? "secondary to PRIMARY CREATIVE BRIEF — Carousel focus when both apply; " : ""}apply to headline and body wording, level of specificity, and how vague transcript language should be rewritten. Keep the transcript as the source of truth for what happens, but use the copywriting context to make implied problems, effects, and corrections more visible, specific, and useful without contradicting the transcript. When the transcript uses vague or high-level language, rewrite it into more specific, observable wording when that meaning is clearly implied by the source material. Do not merely restate vague coaching phrases):\n${copy}\n`
      : "",
    vr
      ? `\nVisual reference (optional: match hook energy, line length, and headline rhythm to this look; transcript remains ground truth for facts):\n${vr}\n`
      : "",
    cf,
    vf
      ? `\n${vf}\n`
      : "",
    `\nHard export rule (first slide only): the single opening slide (minimum \`order\`, usually 1) must have \`headline\` ≤${FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS} chars for the first image overlay (complete words only). All other slides: no ${FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS}-char headline limit.\n`,
    "\nTranscript segments (use segment indices in evidenceSegmentIds):\n",
    transcriptText(segments),
  ].join("");

  const completion = await openai.chat.completions.create({
    model: slidesModel(),
    response_format: { type: "json_object" },
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    messages: [
      {
        role: "system",
        content: generateSlidesSystemContent(typeGuide, hasCarouselFocus),
      },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { slides?: SlidePlan[] };
  try {
    parsed = JSON.parse(raw) as { slides?: SlidePlan[] };
  } catch {
    return [];
  }
  const slides = parsed.slides ?? [];
  const mapped = slides
    .filter((s) => s.headline?.trim())
    .slice(0, 10)
    .map((s, i) => ({
      order: s.order ?? i + 1,
      role: s.role,
      hookStyle: s.hookStyle,
      headline: stripEmDashes(s.headline.trim()),
      body: s.body?.trim() ? stripEmDashes(s.body.trim()) : undefined,
      evidenceSegmentIds: Array.isArray(s.evidenceSegmentIds)
        ? s.evidenceSegmentIds.map(Number).filter((n) => !Number.isNaN(n))
        : [],
    }));
  return enforceFirstSlideHeadlineMaxChars(mapped);
}

/**
 * Safety net: cap headline length on **one** slide only—the first in carousel order
 * (minimum `order`, ties broken by array index). Never affects other slides.
 */
function enforceFirstSlideHeadlineMaxChars(slides: SlidePlan[]): SlidePlan[] {
  if (slides.length === 0) return slides;
  const firstIndex = firstCarouselSlideIndex(slides);

  return slides.map((s, i) => {
    if (i !== firstIndex) return s;
    const h = s.headline.trim();
    const { headline, overflow } = splitFirstSlideHeadlineAtMax(h);
    if (!overflow) return { ...s, headline };
    const bodyParts = [overflow, s.body?.trim()].filter(Boolean);
    return {
      ...s,
      headline,
      body: bodyParts.length > 0 ? bodyParts.join(" ") : undefined,
    };
  });
}

function typePrompt(t: CarouselType): string {
  switch (t) {
    case "example_breakdown":
      return "Before/after or good vs bad; frame-by-frame; contrast slides; pair contrast_a/contrast_b.";
    case "listical":
      return "Title slide + numbered list items; patterns not accusatory mistakes; hook optional.";
    case "step_by_step":
      return "Ordered steps 1..N; optional intro and closing; chronological.";
    case "belief_shifting":
      return "Pattern interrupt → why common belief wrong → what's true → what to do instead.";
    default:
      return "";
  }
}

/** US English social caption for Instagram/Facebook carousels (Grip & Grind / climbing KLT microcopy). */
const CAROUSEL_SOCIAL_CAPTION_SYSTEM = `You write ONE post caption for a climbing / on-the-wall training carousel. The product voice is "Grip & Grind": drills, technique, and training clarity for climbers.

Apply Know–Like–Trust (KLT) and persuasion psychology:
- Know: orient the reader to what this post and the carousel teach (mission, benefit, or pattern in plain language).
- Like: relatability, inclusive "we/you", empathy for frustrating moves or guesswork, friendly conversational US English.
- Trust: credibility without fabrication; authority (coaches, structured drills), social proof only as soft phrasing ("climbers like you") unless the user message supplies real numbers; never invent statistics or fake endorsements.

Use these levers where natural: reciprocity (quick useful angle), social proof (community, shared experience), authority (expert-designed, tested approach), similarity/liking (shared climber identity), short story or "imagine" beat, clarity (short sentences, one main CTA idea, no jargon).

Style rules:
- Active voice; strong verbs (train, unlock, dial in, send, fix, join).
- Second person "you" and inclusive "we/our" where it fits.
- Warm, authoritative, not hypey, not engagement-bait.
- Optional rhetorical question opening is fine.
- 2–4 short paragraphs OR one block with line breaks; scannable on mobile.
- End with a separate line of 3–5 relevant hashtags for climbing/training (no spam).
- Enumeration consistency: if you start a numbered or ordinal list, you MUST use the same pattern throughout. Either "Step 1: … Step 2: …" or "First, … Second, …" or "1) … 2) …" — never mix these in the same caption. Do not say "the first step" in narrative prose and then start "Step 1:" in the next paragraph; that reads as redundant.
- Never write a list of one. If you label a "Step 1" or "First" you must follow with at least a Step 2 / Second. If you only have one point to make, write it as plain prose (no number, no ordinal).

Stay aligned with the slide themes and transcript; do not contradict facts from the transcript. Do not repeat every slide headline; synthesize the through-line for the feed.

Never use em dashes in the caption.

Return JSON only: {"caption":"<string>"}  Use at most ~2200 characters total (Instagram limit).`.trim();

const CAROUSEL_SOCIAL_CAPTION_CAROUSEL_FOCUS_APPENDIX = `When the user message includes PRIMARY CREATIVE BRIEF — Carousel focus, open the caption with the same idea order as the brief (first problem/symptom named in the brief leads the first sentence); then tie to mechanisms and slides. Copywriting context is secondary to that brief; do not contradict transcript facts.`.trim();

export async function generateCarouselSocialCaption(
  segments: TranscriptSegment[],
  slides: SlidePlan[],
  title: string | undefined,
  hint: string | undefined,
  carouselType: CarouselType,
  apiKey: string,
  options?: {
    copyContext?: string;
    visualReferencePrompt?: string;
    carouselFocus?: string;
  }
): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const copy = options?.copyContext?.trim();
  const vr = options?.visualReferencePrompt?.trim();
  const cf = carouselFocusBlock(options?.carouselFocus);
  const slideOutline = slides
    .map((s, i) => {
      const body = s.body?.trim();
      return `Slide ${i + 1}: ${s.headline.trim()}${body ? ` | ${body}` : ""}`;
    })
    .join("\n");
  const user = [
    `Video title: ${title ?? "(none)"}`,
    `Creator hint: ${hint ?? "(none)"}`,
    `Carousel format: ${carouselType}`,
    copy
      ? `\nCopywriting context (tone, brand facts, numbers; only use claims that appear here or in the transcript):\n${copy}\n`
      : "",
    vr
      ? `\nVisual reference (optional: align caption voice and CTA energy with this aesthetic):\n${vr}\n`
      : "",
    cf,
    "\nSlide plan (align caption with this arc):\n",
    slideOutline,
    "\n\nTranscript (for factual alignment; do not quote verbatim unless short):\n",
    transcriptText(segments),
  ].join("");

  const captionSystem =
    CAROUSEL_SOCIAL_CAPTION_SYSTEM +
    (options?.carouselFocus?.trim()
      ? `\n\n${CAROUSEL_SOCIAL_CAPTION_CAROUSEL_FOCUS_APPENDIX}`
      : "");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: captionSystem },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { caption?: string };
    const c = parsed.caption?.trim();
    return c && c.length > 0 ? stripEmDashes(c).slice(0, 2200) : "";
  } catch {
    return "";
  }
}

export const STUB_CAROUSEL_SOCIAL_CAPTION =
  "Grip & Grind: train smarter on the wall. Swipe through for the breakdown. (Stub mode: set OPENAI_API_KEY for an AI-written caption.)";

/** Stub slides when no API key (dev only). */
export function stubSlidesFromTranscript(segments: TranscriptSegment[]): SlidePlan[] {
  const chunk = Math.max(1, Math.ceil(segments.length / 5));
  const out: SlidePlan[] = [];
  for (let i = 0; i < 5 && i * chunk < segments.length; i++) {
    const ids = segments
      .slice(i * chunk, (i + 1) * chunk)
      .map((_, j) => i * chunk + j)
      .filter((id) => id < segments.length);
    const text = stripEmDashes(
      ids
        .map((id) => segments[id]?.text)
        .join(" ")
        .slice(0, i === 0 ? FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS : 100)
    );
    out.push({
      order: i + 1,
      role: i === 0 ? "hook" : "body",
      headline: text || `Slide ${i + 1}`,
      evidenceSegmentIds: ids,
    });
  }
  return out;
}
