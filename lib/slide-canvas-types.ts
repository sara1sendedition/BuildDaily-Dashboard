/** Canvas text styling for carousel slides (video frames + overlay). */

/** Coarse vertical band for the text block (vision-matched to reference image). */
export type ReferenceTextPlacementVertical =
  | "top"
  | "upper"
  | "center"
  | "lower"
  | "bottom";

/** Horizontal alignment of the text block. */
export type ReferenceTextPlacementHorizontal = "left" | "center" | "right";

/**
 * Where to place the headline + body stack on the slide canvas (from reference image).
 * Optional norms 0–1 refine the center of the cluster (overrides coarse vertical when set).
 */
export type ReferenceTextPlacement = {
  vertical: ReferenceTextPlacementVertical;
  horizontal: ReferenceTextPlacementHorizontal;
  textBlockCenterYNorm?: number | null;
  textBlockCenterXNorm?: number | null;
};

export type SlideCanvasTextStyle = {
  /** Fallback when primary/secondary fills are omitted */
  textFill: string;
  /**
   * Carousel **primary** text: slide `headline` / hook (largest lines, list hooks, first wrapped line).
   */
  textFillPrimary?: string;
  /**
   * Carousel **secondary** text: slide `body`, extra wrapped headline lines, slide counter.
   */
  textFillSecondary?: string;
  /** Chevron / small UI accents (carousel slide “next” control fill) */
  accentStroke: string;
  /** Text stroke color (rgba or hex). Default: dark translucent in renderer. */
  outlineStroke?: string;
  /** Multiplies heuristic outline width from font size (default 1). */
  outlineWidthScale?: number;
  dropShadowStrength?: "none" | "light" | "medium" | "heavy";
  /** Letter-spacing (em) for primary-sized lines */
  letterSpacingPrimaryEm?: number;
  /** Letter-spacing (em) for secondary-sized lines */
  letterSpacingSecondaryEm?: number;
  /** Registered font for primary (headline) lines, e.g. Poppins Bold */
  fontFamilyPrimary?: string;
  /** Registered font for secondary (body) lines, e.g. Poppins SemiBold */
  fontFamilySecondary?: string;
  /** Primary (headline) font size in px; defaults to layout preset when omitted */
  fontSizePrimaryPx?: number;
  /** Secondary (body / subtitle) font size in px */
  fontSizeSecondaryPx?: number;
  /** Headline → subtitle gap for stacked layouts (px); overrides scaled default from preset */
  gapBeforeBodyPx?: number;
  /** Title → body gap for lower-third layout (px) */
  gapAfterTitlePx?: number;
  /**
   * When set, headline/body are positioned like the reference graphic instead of
   * fixed stacked-center / lower-third layouts.
   */
  referencePlacement?: ReferenceTextPlacement | null;
};
