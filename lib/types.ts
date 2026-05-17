export type CarouselType =
  | "example_breakdown"
  | "listical"
  | "step_by_step"
  | "belief_shifting";

export type HookStyle =
  | "shared_experience"
  | "gentle_reframe"
  | "patterns"
  | "guidance"
  | "realization";

export type SlideRole =
  | "hook"
  | "contrast_a"
  | "contrast_b"
  | "list_item"
  | "step"
  | "belief_old"
  | "belief_new"
  | "cta"
  | "body"
  | "title";

export interface TranscriptSegment {
  id: number;
  text: string;
  startSec: number;
  endSec: number;
}

export interface CarouselRecommendation {
  recommendedType: CarouselType;
  confidence: "high" | "medium" | "low";
  rationale: string;
  runnerUp?: CarouselType;
}

export interface SlidePlan {
  order: number;
  role?: SlideRole;
  hookStyle?: HookStyle;
  headline: string;
  body?: string;
  evidenceSegmentIds: number[];
}

export interface BrandingPreset {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
  fontFamilyTitle: string;
  fontFamilyBody: string;
}

export type LayoutId = "stacked_center" | "split_lower_third";

/**
 * Suggested canonical caption pointers (model may also output quantified variants).
 * IMPORTANT: do NOT include the word "caption" in any of these — the rendered image
 * already shows a "READ CAPTION" pill below the subline, and including "caption" here
 * makes the on-image overlay say "caption" twice (e.g. "Caption for cues" + READ CAPTION pill).
 */
export const CANONICAL_CAPTION_POINTERS = [
  "Steps below",
  "Progressions below",
  "Cues below",
] as const;

/** Prior LLM output when user regenerates with feedback (image post). */
export interface PreviousImagePostPlan {
  hook: string;
  microCta: string;
  caption: string;
  altText: string;
}

/** LLM output: on-image hook + caption pointer + caption (image post). */
export interface ImagePostPlan {
  /** Main hook only (~5–9 words): pain point / outcome, concrete not aspirational. */
  hook: string;
  /**
   * Second line: what lives in the caption  -  prefer quantified pointers
   * (e.g. "3 cues + 2 progressions in caption") when the content supports it;
   * otherwise one of the canonical short forms.
   */
  microCta: string;
  caption: string;
  evidenceSegmentIds: number[];
  /** Instagram alt text: scene + overlay meaning for screen readers. */
  altText: string;
}

/** LLM output: X thread + Threads posts from video transcript (no auto-post). */
export interface SocialMicroSnapshot {
  /** Ordered tweets: [0] first post, rest are thread replies in order. */
  twitterThread: string[];
  /** Ordered Threads posts (continuation = reply chain). */
  threadsPosts: string[];
  /** One line: suggested still or clip (4:5 / 9:16) to attach on Threads. */
  threadsVisualSuggestion: string;
}
