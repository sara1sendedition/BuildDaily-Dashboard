import OpenAI from "openai";
import type {
  ImagePostPlan,
  PreviousImagePostPlan,
  TranscriptSegment,
} from "./types";
import { CANONICAL_CAPTION_POINTERS } from "./types";
import { stripEmDashes } from "./strip-em-dash";
import { MAX_COPY_CONTEXT_CHARS } from "./copy-context";
import { MAX_REFERENCE_SOURCES_CHARS } from "./reference-sources";
import { MAX_COPY_FEEDBACK_CHARS } from "./copy-feedback";

const MAX_HOOK_CHARS = 120;
const MAX_MICRO_CTA_CHARS = 100;
const MAX_ALT_TEXT_CHARS = 420;

function transcriptText(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (s, i) =>
        `[${i}] ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s: ${s.text}`
    )
    .join("\n");
}

/** Quantified pointers; empty string is normalized away later with a default subline. */
function normalizeCaptionPointer(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, MAX_MICRO_CTA_CHARS);
  if (!s) return "";
  const hit = CANONICAL_CAPTION_POINTERS.find((m) => m === s);
  if (hit) return hit;
  return s;
}

/**
 * Counts discrete labeled steps/cues in the caption (Step 1:, Cue 2:, or markdown "1. " lines).
 * Used to ensure the subline does not promise more than the caption delivers.
 */
export function countNumberedDeliverablesInCaption(caption: string): number {
  const t = caption;
  let max = 0;
  const strict = t.matchAll(/\b(?:Step|Cue)\s*(\d+)\s*[:.\-]/gi);
  for (const m of strict) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  if (max === 0) {
    const loose = t.matchAll(/\b(?:Step|Cue)\s*(\d+)\b/gi);
    for (const m of loose) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  if (max > 0) return max;
  const md = t.matchAll(/^\s*(\d+)\.\s+\S/gm);
  for (const m of md) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

/** If subline promises N steps/cues but caption has fewer, rewrite subline to match reality. */
function alignMicroCtaToCaption(microCta: string, caption: string): string {
  if (/\d+\s*\+\s*\d+/.test(microCta)) return microCta;
  const m = microCta.match(/(\d+)\s*(steps|cues|progressions)\b/i);
  if (!m) return microCta;
  const promised = parseInt(m[1], 10);
  const kind = m[2].toLowerCase();
  const delivered = countNumberedDeliverablesInCaption(caption);
  if (delivered >= promised) return microCta;
  if (delivered === 0) {
    return "Full breakdown below";
  }
  const singular =
    kind === "steps" ? "step" : kind === "cues" ? "cue" : "progression";
  const plural = kind;
  if (delivered === 1) {
    return `1 ${singular} + more below`;
  }
  return `${delivered} ${plural} below`;
}

function normalizeAltText(raw: unknown, hook: string, microCta: string): string {
  const s = String(raw ?? "").trim().slice(0, MAX_ALT_TEXT_CHARS);
  if (s.length >= 40) return s;
  return `Climbing instruction image. Overlay: "${hook.slice(0, 90)}" ${microCta.slice(0, 60)}`.slice(
    0,
    MAX_ALT_TEXT_CHARS
  );
}

/**
 * Models often return one paragraph with no `\\n`, so the UI looks like a single line.
 * If there are no line breaks, split on sentence boundaries into opener (2 sentences) + body.
 */
export function ensureCaptionLineBreaks(caption: string): string {
  const t = caption.trim();
  if (!t) return t;
  if (/\r?\n/.test(t)) {
    return t.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return t;

  const line1 = sentences[0];
  const line2 = sentences[1];
  const rest = sentences.slice(2).join(" ");
  if (!rest) return `${line1}\n${line2}`;
  return `${line1}\n${line2}\n\n${rest}`;
}

/** If the model omitted hashtags, append a minimal climbing block so posts always have tags. */
function ensureHashtagBlock(caption: string): string {
  const t = caption.trim();
  if (!t) return t;
  if (/#\w/.test(t)) return t;
  return `${t}\n\n#rockclimbing #bouldering #climbing`;
}

export async function generateImagePost(
  segments: TranscriptSegment[],
  title: string | undefined,
  hint: string | undefined,
  apiKey: string,
  options?: {
    copyContext?: string;
    referenceSources?: string;
    /** User notes to refine tone, length, emphasis - applied on top of other rules. */
    copyFeedback?: string;
    /** Prior draft when regenerating; pair with copyFeedback for targeted revisions. */
    previousPlan?: PreviousImagePostPlan;
    /** Image-post visual reference (Settings → Visual references). */
    visualReferencePrompt?: string;
  }
): Promise<ImagePostPlan> {
  const openai = new OpenAI({ apiKey });
  const copy = options?.copyContext?.trim()?.slice(0, MAX_COPY_CONTEXT_CHARS);
  const ref = options?.referenceSources
    ?.trim()
    ?.slice(0, MAX_REFERENCE_SOURCES_CHARS);
  const feedback = options?.copyFeedback
    ?.trim()
    ?.slice(0, MAX_COPY_FEEDBACK_CHARS);
  const prev = options?.previousPlan;
  const vr = options?.visualReferencePrompt?.trim();
  const user = [
    `Video title: ${title ?? "(none)"}`,
    `Creator hint: ${hint ?? "(none)"}`,
    copy
      ? `\nCopywriting context (voice, audience, brand rules; must not contradict the transcript):\n${copy}\n`
      : "",
    vr
      ? `\nVisual reference (optional: match hook wording, subline shape, and caption energy to this on-image aesthetic; transcript stays ground truth):\n${vr}\n`
      : "",
    ref
      ? `\n--- Reference sources (user-provided excerpts / notes - trusted material to expand the caption when the transcript is thin) ---\n${ref}\n`
      : "",
    feedback
      ? `\n--- User feedback (refine the output; honor this where it does not conflict with the transcript) ---\n${feedback}\n`
      : "",
    prev
      ? `\n--- Previous draft (revise when feedback applies; keep transcript accuracy; you may change hook, microCta, caption, altText, and evidenceSegmentIds as needed) ---\nhook: ${prev.hook}\nmicroCta: ${prev.microCta}\ncaption:\n${prev.caption}\naltText: ${prev.altText}\n`
      : "",
    "\nTranscript segments (primary ground truth for what the video says; use segment indices in evidenceSegmentIds for which moment best matches the hook visually):\n",
    transcriptText(segments),
  ].join("");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You create one Instagram 4:5 (1080×1350) still: HOOK headline, CAPTION POINTER subline, CAPTION body (including hashtags), and ALT TEXT. Align with 2026 best practice: specific payoff, fast caption payoff, consumption-oriented CTA (not vague "read more" curiosity traps), no engagement-bait ("Comment YES", "Tag friends").

When the user message includes a Visual reference block, align hook and subline rhythm with that reference while keeping transcript truth.

Never use the Unicode em dash character (U+2014) in hook, microCta, caption, or altText. Use commas, periods, colons, or " - " (space-hyphen-space) instead.

Truth hierarchy:
- **Transcript** = what the video actually says/shows. Never claim the video taught something that is not supported by the transcript.
- **Reference sources** (if provided) = trusted material to expand thin clips. Synthesize; no fake citations.
- **User feedback** (if provided) = requested adjustments (tone, length, emphasis, what to fix). Apply without breaking transcript truth. If **previous draft** is also provided, revise that draft toward the feedback rather than starting from scratch unless feedback asks for a full rethink.
- Avoid clickbait that the caption cannot support (hurts trust and aligns poorly with recommendation quality signals).

## Hook (field "hook") - one strong line, problem-first
- **Goal:** In under one second the viewer should feel **recognition, tension, or curiosity** - not vague inspiration. Anchor to a **specific struggle, inefficiency, or mistake** the transcript can support (e.g. stalling mid-move, overgripping, hips off the wall, cutting feet, choppy movement, bent arms, awkward feet).
- **Avoid (banned patterns for hooks):** Abstract “wellness” / generic fitness speak: **unlock**, **unlock your flow**, **find your flow**, **level up**, **harness your…** without a concrete problem; broad “X tips for climbing” **without** a clear pain; phrases that could apply to any sport. Do **not** use “Unlock your flow”-style hooks.
- **Prefer patterns like:** “If every move feels choppy, …” / “Why your climbing feels stiff” / “Climbing feels hard for no reason? …” / “Still bending your arms here?” - **recognition + implied problem**, tied to what the clip actually shows or says.
- **Audience-awareness rule (CRITICAL):** Name the climber's **felt experience**, not the coach's **diagnosis**. The audience is climbers who have the problem but do NOT yet know they have it — they cannot self-recognize a hook that names the technical mistake by its coach-side label. Open from the felt symptom (the thing they already notice about themselves); let the caption deliver the diagnosis.
  - ✅ Good (felt symptom): “Why your forearms blow up two routes in” / “Feel stuck mid-move every time?” / “Climbing feels harder than it should?” / “Arms always tired before your legs?”
  - ❌ Bad (coach diagnosis the climber doesn't recognize): “Still pulling through the holds?” (a climber pulling through holds does not know they are pulling through holds) / “Stop overgripping” (most overgrippers don't know they are overgripping; they feel pumped) / “Hips off the wall again?” (climber feels reach-y or off-balance, not "hip-off-wall")
  - Translate every coach-label to a felt experience before writing the hook. If the only frame you can find is a coach-label, prepend "If…" + felt symptom (e.g. "If your arms tire way before your legs, you might be pulling through your holds." — but the **felt** half is the hook line; the diagnosis is for the caption).
- **Still prefer** named failure modes and concrete cues over marketing language. No engagement bait.
- **Length:** One strong line (~6–14 words), or two very short lines only if needed (~${MAX_HOOK_CHARS} characters max). Put **steps, cues, lists, and hashtags in the caption** - do not use the hook as a second headline that competes with a subline (e.g. avoid “Unlock …: 3 cues for climbing”).

## Caption pointer (field "microCta") - **required** subline under the hook
- **Always** output a **non-empty** microCta: one short line that **invites the viewer to open the caption** for steps, cues, or the full payoff (Instagram hides most of the caption until they tap).
- **Do not** return \`""\` for microCta. The hook is the stop; the subline is the bridge to the caption.
- **Strongly prefer quantified pointers** when the caption supports them (e.g. “3 cues below”) without repeating the hook verbatim.
- If quantified copy would over-promise vs. the caption, use exactly one of: ${CANONICAL_CAPTION_POINTERS.map((x) => `"${x}"`).join(", ")} or a similarly short invitation like “Full breakdown below”.
- **Never use the word "caption" in microCta.** The rendered image already shows a "READ CAPTION" pill directly below the subline; including "caption" in the subline makes the overlay say "caption" twice (e.g. ❌ "Caption for cues" + READ CAPTION pill = "caption" twice). Use "below", "in the caption text", or omit the location word entirely (e.g. "3 cues below", "Full breakdown below", "Steps below").
- **One short phrase only** - no second headline. Max ~${MAX_MICRO_CTA_CHARS} characters.

### Hook + microCta as a paired unit (CRITICAL READ-FLOW RULE)
The viewer reads the hook and the microCta together as one phrase, in that order. They are NOT two independent statements; they are **setup → payoff bridge**. Write the pair so they read as one continuous thought when spoken aloud.

- If the hook is a **setup** (opens with "If…" / "When…" / "Why…" / "Ever notice…"), the microCta must be the natural **completion** of that setup — a short imperative or recognition payoff like "Try this instead", "Here's the fix", "Watch what changes", "The fix is one cue". Do NOT use a generic quantified pointer ("Cues below", "3 cues below") as the completion of a setup hook — it breaks the read.
- If the hook is **already a complete recognition statement** ("Forearms blow up two routes in?", "Climbing feels harder than it should?"), then the microCta CAN be a quantified pointer ("3 cues below", "Full breakdown below").
- **Never put the bridge phrase inside the hook AND restate it in the subline.** "Try this instead" / "Here's the fix" / "The cue below" belong in EITHER the hook OR the microCta, never both. If your hook ends with "try this instead" or "here's the fix", strip that bridge OUT of the hook and put it in the microCta — the hook becomes the setup-only line.
- **Read the pair out loud.** If "Hook. microCta." sounds stilted, restating, or like two disconnected statements, rewrite the pair so they flow as one thought. Examples:

  ✅ GOOD pairing (setup hook → imperative payoff):
    - hook: "If your arms feel too pumped"
    - microCta: "Try this instead"

  ✅ GOOD pairing (recognition hook → quantified pointer):
    - hook: "Forearms blow up two routes in?"
    - microCta: "3 cues below"

  ✅ GOOD pairing (felt-symptom hook → breakdown pointer):
    - hook: "Climbing feels harder than it should?"
    - microCta: "Full breakdown below"

  ❌ BAD pairing (hook over-completes; subline becomes vague filler):
    - hook: "If your arms feel too pumped, try this instead."
    - microCta: "Key cue below for smoother movements."
    - Why bad: the hook already contains the bridge ("try this instead"), so the subline restates abstractly. "Smoother movements" is vague benefit language; the rendered image then reads as two disconnected promises with no specificity.
    - Fix: split — hook becomes "If your arms feel too pumped"; microCta becomes "Try this instead".

  ❌ BAD pairing (setup hook + generic pointer):
    - hook: "Why your forearms blow up two routes in"
    - microCta: "Cues below"
    - Why bad: the setup begs for a payoff completion, not a list pointer. "Why your forearms blow up two routes in. Cues below." reads as broken.
    - Fix: microCta becomes "Here's the fix" or "The cue below" — completes the "Why X…" setup.

### Consistency rule (non-negotiable)
- If microCta promises **N steps** or **N cues** or **N progressions** (e.g. "3 steps below"), the caption MUST deliver **N clearly labeled items**: use **"Step 1:", "Step 2:", … "Step N:"** (or **Cue 1…N**) each on its own line/paragraph with **substantive** content - not one step and filler.
- If the transcript only supports **one** actionable idea, do **not** promise "3 steps". Use instead: "Key cue below", "Full breakdown below", or a canonical short line like "Cues below".
- Same for "N cues + M progressions": the caption must actually include that many labeled cues and progressions if you use that phrasing.

## Caption (field "caption") - body + discovery (keywords + hashtags)

**Main caption (before hashtags):**
- First **1–2 lines** must pay off the overlay immediately (Instagram truncates; read-more is friction).
- Line 1: restate the promised outcome in plain language.
- Line 2: first actionable cue/step.
- If you promised multiple steps/cues in microCta, follow the opener with **Step 1:** … **Step 2:** … (etc.), each with real content from the transcript/sources.
- Then: extra context, scaling, pitfalls - from transcript and (if relevant) reference sources.
- Optional **one** closing question that implies they read the cues (e.g. which cue slips first) - not generic "Thoughts?" and not engagement-bait.
- **Keywords in the caption** matter for discovery (often more than hashtag count). Weave important climbing terms naturally in the main text so Search/Explore can match intent - not only in tags.

**Hashtags (2023–2026 Instagram / Meta-aligned practice for climbing content):**
- **MANDATORY:** Every caption MUST end with a **hashtag block**. Do not skip hashtags. If you omit them, the post fails the brief.
- Instagram emphasizes **quality over quantity**: use **3–5 highly relevant** hashtags. Do **not** spam tags; overloading does not boost reach.
- **Format (required):** After the last sentence of the main caption, output **\\n\\n** then **one line** of **3–5** space-separated hashtags (each token MUST start with **#**). Example ending: \\n\\n#rockclimbing #climbingdrills #footwork
- **Mix** tags: at least one **broad** tag (e.g. #rockclimbing or #bouldering), **niche/skill** tags matching the clip (#climbingdrills, #tradclimbing, etc.), optional **branded** tag only if context supports it.
- **Avoid:** banned/irrelevant tags, generic filler (#love), and **tag stuffing**. Every tag must match the post.

- Use \\n between lines in the main body; **always** use \\n\\n immediately before the hashtag line.

CRITICAL: "caption" MUST contain real newline escapes (\\n) in JSON and MUST include at least three **#** hashtags on the final line(s). Never return a caption with zero hashtags.

## Alt text (field "altText")
- Describe the scene for screen readers and include terms that align with the caption’s **keywords** and topic (accessibility + consistency with how people search). Hook/pointer meaning in plain language. Max ~${MAX_ALT_TEXT_CHARS} characters.

## evidenceSegmentIds
1–3 segment indices for the background frame. **Prefer** moments that read as **struggle, inefficiency, awkward position, or a clear “fix this” problem** when the transcript supports it - so the still matches tension the hook claims. Avoid only neutral pretty poses if a stronger instructional moment exists.

Return JSON only:
{"hook":"string","microCta":"string","caption":"string","altText":"string","evidenceSegmentIds":[0]}`,
      },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: {
    hook?: string;
    microCta?: string;
    caption?: string;
    altText?: string;
    evidenceSegmentIds?: number[];
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return fallbackPlan(segments);
  }

  const hook = stripEmDashes(
    String(parsed.hook ?? "").trim().slice(0, MAX_HOOK_CHARS)
  );
  let microCta = stripEmDashes(normalizeCaptionPointer(parsed.microCta));
  const caption = stripEmDashes(
    ensureHashtagBlock(
      ensureCaptionLineBreaks(String(parsed.caption ?? "").trim())
    )
  );
  microCta = stripEmDashes(alignMicroCtaToCaption(microCta, caption));
  if (!microCta.trim()) {
    microCta = CANONICAL_CAPTION_POINTERS[2];
  }
  const altText = stripEmDashes(
    normalizeAltText(parsed.altText, hook, microCta)
  );
  let ids = Array.isArray(parsed.evidenceSegmentIds)
    ? parsed.evidenceSegmentIds.filter((n) => typeof n === "number" && n >= 0)
    : [];

  if (!hook || !caption) {
    return fallbackPlan(segments);
  }

  if (ids.length === 0) {
    ids = [0];
  }
  const maxId = Math.max(0, segments.length - 1);
  ids = [...new Set(ids.map((i) => Math.min(Math.floor(i), maxId)))];
  if (ids.length === 0) ids = [0];

  return { hook, microCta, caption, altText, evidenceSegmentIds: ids };
}

function fallbackPlan(segments: TranscriptSegment[]): ImagePostPlan {
  const snippet = stripEmDashes(
    segments[0]?.text?.slice(0, 200) ?? "your video"
  );
  return {
    hook: "Couldn’t parse AI output - here’s your transcript",
    microCta: CANONICAL_CAPTION_POINTERS[0],
    caption: snippet,
    altText:
      "Instructional climbing image with text overlay summarizing the transcript.",
    evidenceSegmentIds: [0],
  };
}

export function stubImagePostFromTranscript(
  segments: TranscriptSegment[]
): ImagePostPlan {
  const t = stripEmDashes(
    segments.map((s) => s.text).join(" ").slice(0, 400)
  );
  return {
    hook:
      "Stub mode: set OPENAI_API_KEY for hooks & captions from your transcript.",
    microCta: CANONICAL_CAPTION_POINTERS[0],
    caption:
      t ||
      "Add a real video and API key. This stub has no transcript content.",
    altText:
      "Placeholder image with overlay text; stub mode without full AI output.",
    evidenceSegmentIds: [0],
  };
}
