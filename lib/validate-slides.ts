/**
 * Post-generation slide validator.
 *
 * Per the architectural principle in Sara's Carousel Generator Copy System Reference:
 * the system prompt enforces structure and the copyContext carries domain intelligence,
 * but the model can still drift under a long prompt. This validator catches the failure
 * modes the prompt cannot reliably enforce on its own and returns structured feedback
 * the pipeline can re-feed to `generateSlides` for a retry.
 *
 * Conservative on purpose: false positives create retry loops, so the rules below only
 * flag patterns that are reliably bad. Subtle issues (anaphora, semantic novelty) are
 * left to the model + prompt; this file catches blatant tease, blatant vagueness, and
 * blatant lack of corrective substance.
 */
import {
  FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS,
  firstCarouselSlideIndex,
} from "./carousel-slide-limits";
import { WEAK_FIRST_HOOK_OPENERS } from "./first-slide-hook-copy";
import type { SlidePlan } from "./types";

export type SlideValidationRule =
  | "tease_body"
  | "vague_phrase"
  | "duplicate_slide"
  | "no_correction_floor"
  | "caption_word_in_body"
  | "first_hook_over_cap"
  | "weak_hook_opener";

export interface SlideValidationError {
  slideOrder: number;
  field: "headline" | "body" | "carousel";
  rule: SlideValidationRule;
  detail: string;
}

export interface SlideValidationResult {
  ok: boolean;
  errors: SlideValidationError[];
  /** Natural-language block to inject into the next generation as targeted feedback. */
  feedbackForRetry: string;
}

/**
 * Tease patterns: body fragments that promise an answer without delivering one.
 * Each regex must match with very low false-positive rate; prefer specific phrasings.
 */
const TEASE_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    // Allow an optional helper verb between the modal and 'why' (e.g. "it might BE why",
    // "this could BE why"). The base case "it is why" and "that's why" still match.
    pattern: /\b(it|this|that)('?s)?\s+(is|might|could|may)(\s+\w+)?\s+why\b/i,
    label: "'(it|this|that) (is|might|could) [be] why' — tease without naming the cause",
  },
  {
    pattern: /\b(here'?s|that'?s)\s+(the|why|how|what)\b/i,
    label: "'here's the…' / 'that's why…' — tease that promises a payoff offstage",
  },
  {
    pattern: /\bthe (real )?reason\b(?![^.]*\b(is|because|comes from)\b[^.]{8,})/i,
    label: "'the reason' without naming what the reason is in the same slide",
  },
  {
    pattern: /\byou'?ll (see|find out|learn|discover)\b/i,
    label: "'you'll see / find out / learn' — defers payoff to a later slide or external content",
  },
  {
    pattern: /\bfind out (why|how|what)\b/i,
    label: "'find out (why|how|what)' — generic curiosity tease",
  },
  {
    pattern: /\bexplains? (it|this|that|why)\b/i,
    label: "'explains it/this' — tells the reader the explanation is somewhere else",
  },
  {
    pattern: /\bread (the )?caption\b/i,
    label: "'read the caption' inside slide body — the rendered pill already says READ CAPTION",
  },
  {
    pattern: /\bkeep (watching|reading|going)\b/i,
    label: "'keep watching/reading' — pure curiosity bait",
  },
];

/**
 * Vague-phrase blacklist from Sara's reference doc + observed model failures.
 * Anti-vague guidance section: "Avoid generic coaching phrases like: use your core,
 * stay in control, create flow, this helps, this improves things."
 */
const VAGUE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\buse your core\b/i, label: "'use your core' — vague, not visible" },
  { pattern: /\bstay in control\b/i, label: "'stay in control' — vague, not visible" },
  { pattern: /\b(create|find|unlock)\s+(your\s+)?flow\b/i, label: "'flow' coaching abstraction" },
  { pattern: /\bbe intentional\b/i, label: "'be intentional' — vague, not actionable" },
  { pattern: /\bthis (helps|improves)\b/i, label: "'this helps/improves' — vague benefit, no observable change" },
  { pattern: /\b(level up|game[- ]chang(e|er|ing))\b/i, label: "marketing abstraction" },
  { pattern: /\bharness (your )?(power|strength|movement)\b/i, label: "'harness your X' — abstract" },
  { pattern: /\bunlock (your |the )?(potential|movement|flow)\b/i, label: "'unlock your X' — marketing fluff" },
  { pattern: /\bmake (a )?(real )?difference\b/i, label: "'make a difference' — vague benefit" },
  { pattern: /\bget the most out of\b/i, label: "'get the most out of' — vague" },
];

/**
 * Words that signal a corrective action — an imperative cue the climber/coach should DO.
 * Climbing-specific verbs first, then generic instructional / coach-meta verbs.
 * Used to enforce "carousels of 4+ slides must deliver ≥2 corrective-action slides."
 */
const CORRECTIVE_VERB_TOKENS = [
  // body / footwork / movement
  "place", "step", "shift", "lower", "raise", "straighten", "engage", "press",
  "trust", "match", "extend", "drop", "flag", "push", "pull", "hook", "twist",
  "turn", "rotate", "drive", "lift", "tuck", "lean", "reach", "stand",
  "bring", "anchor", "load", "weight", "unweight", "move",
  // hands / grip
  "grip", "release", "pinch", "crimp", "open", "loosen", "relax",
  // breath / rhythm / mind
  "breathe", "exhale", "inhale", "pause", "focus", "scan", "feel", "look",
  "watch", "remember",
  // coach-meta (carousel aimed at coaches teaching climbers)
  "encourage", "tell", "let", "keep",
  // generic instructional
  "try", "start", "stop", "use", "swap", "switch", "do",
];

/**
 * Match a corrective verb only when it appears as an imperative — i.e. at sentence start,
 * or after a step/cue label, or after a sequencing word like "First,". This avoids false
 * positives like "Telling them to use their legs is misleading" (the word "use" appears
 * but the slide is describing, not instructing).
 */
const CORRECTIVE_VERBS_ALT = CORRECTIVE_VERB_TOKENS.join("|");

/** Headline pattern: optional step/cue/sequencing prefix, then a corrective verb at start. */
const HEADLINE_CORRECTIVE_REGEX = new RegExp(
  `^\\s*(?:step\\s*\\d+\\s*[:.\\-]\\s*|cue\\s*\\d+\\s*[:.\\-]\\s*|first[,]?\\s+|next[,]?\\s+|now[,]?\\s+|then[,]?\\s+|try[,]?\\s+to\\s+)?(${CORRECTIVE_VERBS_ALT})\\b`,
  "i"
);

/** Body pattern: corrective verb at start of body, after sentence punctuation, or after a step/cue label. */
const BODY_CORRECTIVE_REGEX = new RegExp(
  `(?:^|[.!?]\\s+|\\bstep\\s*\\d+\\s*[:.\\-]\\s*|\\bcue\\s*\\d+\\s*[:.\\-]\\s*|\\bfirst[,]?\\s+|\\bnext[,]?\\s+|\\bnow[,]?\\s+|\\bthen[,]?\\s+|\\btry[,]?\\s+to\\s+)(${CORRECTIVE_VERBS_ALT})\\b`,
  "im"
);

function isCorrectiveSlide(s: SlidePlan): boolean {
  if (HEADLINE_CORRECTIVE_REGEX.test(s.headline ?? "")) return true;
  if (BODY_CORRECTIVE_REGEX.test(s.body ?? "")) return true;
  return false;
}

/** Stopwords to ignore when comparing slides for duplicate-idea overlap. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "get", "got", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "let", "like", "make", "many", "may", "might",
  "more", "much", "must", "my", "no", "nor", "not", "of", "off", "on", "one",
  "only", "or", "our", "out", "over", "own", "per", "she", "so", "some",
  "such", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "to", "too", "two", "up", "upon", "us",
  "use", "using", "very", "via", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "whom", "why", "will", "with", "would", "yet",
  "you", "your", "yours", "youll", "youre",
  // climbing-specific high-frequency words that are not idea content
  "climbing", "climber", "climbers", "wall", "hold", "holds",
]);

function checkBodyTease(slide: SlidePlan): SlideValidationError[] {
  const text = slide.body?.trim();
  if (!text) return [];
  const errs: SlideValidationError[] = [];
  for (const { pattern, label } of TEASE_PATTERNS) {
    if (pattern.test(text)) {
      errs.push({
        slideOrder: slide.order,
        field: "body",
        rule: pattern.source.includes("caption") ? "caption_word_in_body" : "tease_body",
        detail: `Slide ${slide.order} body matches tease pattern: ${label}. Body text: "${text}". Rewrite the body to deliver the substance the headline implies — name the cause, the change, or the action concretely.`,
      });
    }
  }
  return errs;
}

function checkVagueness(slide: SlidePlan): SlideValidationError[] {
  const headline = slide.headline?.trim() ?? "";
  const body = slide.body?.trim() ?? "";
  const errs: SlideValidationError[] = [];
  for (const { pattern, label } of VAGUE_PATTERNS) {
    if (pattern.test(headline)) {
      errs.push({
        slideOrder: slide.order,
        field: "headline",
        rule: "vague_phrase",
        detail: `Slide ${slide.order} headline contains vague phrase: ${label}. Rewrite using an observable action, behavior, or outcome.`,
      });
    }
    if (pattern.test(body)) {
      errs.push({
        slideOrder: slide.order,
        field: "body",
        rule: "vague_phrase",
        detail: `Slide ${slide.order} body contains vague phrase: ${label}. Rewrite using an observable action, behavior, or outcome.`,
      });
    }
  }
  return errs;
}

function tokenizeForOverlap(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Duplicate slide check — Jaccard ≥ 0.6 on combined headline+body content tokens.
 * Threshold tuned to allow shared topical words ("foot", "hip") without flagging,
 * while catching slides that say substantively the same thing.
 */
function checkDuplicates(slides: SlidePlan[]): SlideValidationError[] {
  const tokens = slides.map((s) =>
    tokenizeForOverlap([s.headline, s.body ?? ""].join(" "))
  );
  const errs: SlideValidationError[] = [];
  const seenPairs = new Set<string>();
  for (let i = 0; i < slides.length; i++) {
    for (let j = i + 1; j < slides.length; j++) {
      const pairKey = `${slides[i]!.order}-${slides[j]!.order}`;
      if (seenPairs.has(pairKey)) continue;
      const sim = jaccard(tokens[i]!, tokens[j]!);
      if (sim >= 0.6) {
        seenPairs.add(pairKey);
        errs.push({
          slideOrder: slides[j]!.order,
          field: "body",
          rule: "duplicate_slide",
          detail: `Slide ${slides[j]!.order} ("${slides[j]!.headline}") repeats the same idea as Slide ${slides[i]!.order} ("${slides[i]!.headline}") (Jaccard ${sim.toFixed(2)}). Each slide must add a NEW idea or move the sequence forward — rewrite this slide to deliver a distinct cue, step, or contrast.`,
        });
      }
    }
  }
  return errs;
}

/**
 * Corrective-action floor: for carousels of 4+ slides, at least 2 slides must each
 * contain an imperative-style verb tied to a behavior the climber/coach should perform.
 *
 * Detects the verb anywhere in headline or body — the model often phrases corrections as
 * "Straighten your arms first" or "Move around the hold instead of pulling through it."
 */
function checkCorrectiveFloor(slides: SlidePlan[]): SlideValidationError[] {
  if (slides.length < 4) return [];
  const correctiveSlides = slides.filter(isCorrectiveSlide);
  if (correctiveSlides.length >= 2) return [];
  return [
    {
      slideOrder: 0,
      field: "carousel",
      rule: "no_correction_floor",
      detail: `Carousel has ${slides.length} slides but only ${correctiveSlides.length} slide(s) contain a concrete corrective action (imperative verb tied to a behavior). At least 2 slides must each deliver a specific thing the climber/coach should DO differently. Reaching slide 4+ with zero corrective actions = brief failed; re-plan so framing/diagnosis slides give way to actionable cues. If the transcript supports only one corrective action, expand it across slides (cue → drill → checkpoint → common pitfall) rather than padding with framing.`,
    },
  ];
}

function checkFirstSlideHook(slides: SlidePlan[]): SlideValidationError[] {
  if (slides.length === 0) return [];
  const idx = firstCarouselSlideIndex(slides);
  const s = slides[idx]!;
  const headline = s.headline.trim();
  const errs: SlideValidationError[] = [];
  if (headline.length > FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS) {
    errs.push({
      slideOrder: s.order,
      field: "headline",
      rule: "first_hook_over_cap",
      detail: `Slide 1 headline is ${headline.length} chars (max ${FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS} for the yellow hook on image 1). Shorten to a complete phrase; move the rest to \`body\`.`,
    });
  }
  for (const { pattern, label } of WEAK_FIRST_HOOK_OPENERS) {
    if (pattern.test(headline)) {
      errs.push({
        slideOrder: s.order,
        field: "headline",
        rule: "weak_hook_opener",
        detail: label,
      });
      break;
    }
  }
  return errs;
}

export function validateSlides(slides: SlidePlan[]): SlideValidationResult {
  if (!slides || slides.length === 0) {
    return { ok: true, errors: [], feedbackForRetry: "" };
  }
  const errors: SlideValidationError[] = [];
  for (const s of slides) {
    errors.push(...checkBodyTease(s));
    errors.push(...checkVagueness(s));
  }
  errors.push(...checkFirstSlideHook(slides));
  errors.push(...checkDuplicates(slides));
  errors.push(...checkCorrectiveFloor(slides));

  const ok = errors.length === 0;
  const feedbackForRetry = ok
    ? ""
    : buildRetryFeedback(errors);
  return { ok, errors, feedbackForRetry };
}

function buildRetryFeedback(errors: SlideValidationError[]): string {
  const intro =
    "VALIDATOR FEEDBACK (a previous attempt at these slides failed automated checks; address every item below in this regeneration; keep transcript fidelity):";
  const lines = errors.map((e, i) => `${i + 1}. [${e.rule}] ${e.detail}`);
  return [intro, ...lines].join("\n");
}
