/**
 * Structured profile for a visual reference (carousel / photo / image).
 * Some fields are filled by client-side image math; typography and many
 * deck signals are placeholders for manual notes or future OCR/layout ML.
 */

export type VisualReferenceKind = "carousel" | "photo" | "image";

export type InferenceSource = "computed" | "manual" | "unknown";

/** Color + tone block (mostly computable from pixels). */
export type ReferenceColorTone = {
  exposureMeanLuma01: number | null;
  /** Rough EV-style offset vs a mid-grey target (~0.45), heuristic. */
  exposureOffsetEvEstimate: number | null;
  highlightsMeanLuma01: number | null;
  shadowsMeanLuma01: number | null;
  blackPointLuma01: number | null;
  whitePointLuma01: number | null;
  /** p95 − p5 on luma (contrast / “levels” spread). */
  tonalSpread01: number | null;
  lumaStd01: number | null;
  /** Correlated color temperature from mean chromaticity (unreliable on strongly tinted scenes). */
  colorTemperatureKelvin: number | null;
  colorTemperatureReliable: boolean;
  /** CIELAB a* (D65): positive ≈ magenta, negative ≈ green. */
  tintGreenMagentaAstar: number | null;
  /** Mean chroma sqrt(a*^2+b*^2), normalized ~0–1 for display. */
  saturationIndex01: number | null;
  /** Midtone chroma / overall chroma; correlates with “vibrance-style” emphasis. */
  vibranceVsSaturationProxy: number | null;
};

export type PaletteSwatch = {
  hex: string;
  /** Approximate share of sampled pixels (0–1). */
  weight: number;
};

export type ReferenceGradient = {
  detected: boolean;
  strength01: number | null;
  direction: "vertical" | "horizontal" | "none" | "mixed";
};

export type ReferenceComposition = {
  aspectRatio: number;
  aspectRatioLabel: string;
  /** Heuristic: high edge density in center band vs edges → possible text block. */
  textRegionLikelihood01: number | null;
  focalPointNorm: { x: number; y: number } | null;
  balance: "symmetrical" | "weighted_left" | "weighted_right" | "unknown";
};

export type ReferenceTypography = {
  inference: InferenceSource;
  fontFamily: string | null;
  fontColorHex: string | null;
  fontSizePxEstimate: number | null;
  fontWeight: "regular" | "semibold" | "bold" | null;
  lineHeightLeading: number | null;
  letterSpacingEm: number | null;
  textAlign: "left" | "center" | "right" | "justified" | null;
  maxCharsPerLine: number | null;
  maxCharsPerSlide: number | null;
  maxLineWidthPx: number | null;
  linesPerSlideEstimate: number | null;
  textBoxPaddingPx: { top: number; right: number; bottom: number; left: number } | null;
  hierarchy: {
    headline: string | null;
    subhead: string | null;
    body: string | null;
    cta: string | null;
  };
  caseUsage: "all_caps" | "sentence" | "title" | "mixed" | null;
  strokeOutlineShadow: string | null;
  gridSystemNote: string | null;
};

export type ReferenceCopyDeck = {
  inference: InferenceSource;
  hookFormat: "question" | "statement" | "curiosity_gap" | "other" | null;
  sentenceLengthPattern: "short" | "long" | "mixed" | null;
  readingLevelNote: string | null;
  ctaStructure: string | null;
  slideProgressionPattern: string | null;
};

export type ReferenceBackground = {
  type: "solid" | "gradient" | "photo" | "texture" | "unknown";
  imageStyle: "photo" | "illustration" | "3d" | "none" | "unknown";
};

export type ReferenceShapesIcons = {
  iconsUsed: boolean | null;
  iconStyleNote: string | null;
  shapesNote: string | null;
};

export type ReferenceOverlays = {
  blur: boolean | null;
  grain: boolean | null;
  glow: boolean | null;
  otherNote: string | null;
};

export type ReferenceBranding = {
  logoPlacement: string | null;
  brandConsistencyNote: string | null;
  signatureElements: string | null;
  repeatableLayout: "repeated" | "varied" | "unknown" | null;
};

export type ReferenceTechnical = {
  widthPx: number;
  heightPx: number;
  megapixels: number;
  exportFormatNote: string | null;
  compressionArtifactScore01: number | null;
  /** Suggested safe inset as fraction of min(w,h), for IG UI overlays. */
  safeAreaInsetFraction: number;
};

/** Client-side OCR + layout heuristics (Tesseract); optional on any reference kind. */
export type ReferenceOcrLine = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type ReferenceOcrInference = {
  schemaVersion: 1;
  analyzedAtIso: string;
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  meanConfidence: number;
  lines: ReferenceOcrLine[];
  lineLengthStats: {
    maxChars: number;
    medianChars: number;
    lineCount: number;
  };
  /** Text block vs image edges (0–1); null if no lines detected. */
  marginsNorm: {
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null;
  hookFormatGuess: "question" | "statement" | "curiosity_gap" | "unknown";
  ctaHints: {
    mentionsCaption: boolean;
    mentionsSwipe: boolean;
    mentionsLink: boolean;
    mentionsSave: boolean;
    mentionsFollow: boolean;
  };
  /**
   * Tesseract-reported word attributes (often empty in pure LSTM builds).
   * Not a substitute for commercial font-ID services.
   */
  fontFromEngine: {
    engineFontNames: string[];
    medianFontSizePx: number | null;
    boldMajority: boolean | null;
    serifMajority: boolean | null;
    disclaimer: string;
  };
  /** Manual-style documentation for what OCR cannot see. */
  layoutDocumentation: {
    logoPlacement: string;
    grid: string;
    strokeShadow: string;
  };
};

/** Image-post hook canvas styling (optional; set in Visual references for `image` kind). */
export type ImageHookOverlayStyle = {
  /** One `#RRGGBB` per logical line of the hook (split on `\n`); cycles if fewer than lines. */
  hookLineFills?: string[];
  /** Extra letter-spacing in em units (e.g. -0.02 tighter, 0.04 looser). Applied to hook only. */
  letterSpacingEm?: number;
  /** Multiplier for hook outline width (default 1). */
  hookOutlineScale?: number;
  /** Subline (`microCta`) fill; defaults to hook fallback / overlay text color. */
  sublineFill?: string;
};

export type VisualReferenceProfile = {
  schemaVersion: 1;
  kind: VisualReferenceKind;
  fileName: string;
  analyzedAtIso: string;
  /** When `kind === "image"`, used by `render-image-post` for multi-color hook + tracking. */
  imageHookOverlay?: ImageHookOverlayStyle;
  /** Tesseract OCR + heuristics (browser; optional). */
  referenceOcr?: ReferenceOcrInference;
  colorTone: ReferenceColorTone;
  palette: { swatches: PaletteSwatch[] };
  gradient: ReferenceGradient;
  composition: ReferenceComposition;
  background: ReferenceBackground;
  shapesIcons: ReferenceShapesIcons;
  overlays: ReferenceOverlays;
  typography: ReferenceTypography;
  copyDeck: ReferenceCopyDeck;
  branding: ReferenceBranding;
  technical: ReferenceTechnical;
  /** Short designer notes (persisted with this reference). */
  manualNotes: string;
  /** Longer checklist: fonts, hooks, margins, CTA, etc. (manual). */
  manualExtendedMarkdown: string;
};

export type StoredVisualReference = {
  schemaVersion: 1;
  kind: VisualReferenceKind;
  fileName: string;
  thumbnailDataUrl: string | null;
  profile: VisualReferenceProfile;
};

export function emptyTypography(): ReferenceTypography {
  return {
    inference: "unknown",
    fontFamily: null,
    fontColorHex: null,
    fontSizePxEstimate: null,
    fontWeight: null,
    lineHeightLeading: null,
    letterSpacingEm: null,
    textAlign: null,
    maxCharsPerLine: null,
    maxCharsPerSlide: null,
    maxLineWidthPx: null,
    linesPerSlideEstimate: null,
    textBoxPaddingPx: null,
    hierarchy: { headline: null, subhead: null, body: null, cta: null },
    caseUsage: null,
    strokeOutlineShadow: null,
    gridSystemNote: null,
  };
}

export function emptyCopyDeck(): ReferenceCopyDeck {
  return {
    inference: "unknown",
    hookFormat: null,
    sentenceLengthPattern: null,
    readingLevelNote: null,
    ctaStructure: null,
    slideProgressionPattern: null,
  };
}

export function emptyBranding(): ReferenceBranding {
  return {
    logoPlacement: null,
    brandConsistencyNote: null,
    signatureElements: null,
    repeatableLayout: null,
  };
}
