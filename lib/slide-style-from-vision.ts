/**
 * Map vision-extracted reference style to canvas slide render options.
 * Primary / secondary align with slide headline vs body (carousel copy roles).
 */

import type { SlideCanvasTextStyle } from "@/lib/slide-canvas-types";
import type { VisionCarouselTextStyle } from "@/lib/extract-carousel-style-vision";
import {
  formatVisionStyleForLlmPrompt,
  visionStrokeToCanvasRgba,
} from "@/lib/extract-carousel-style-vision";
import {
  STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX,
  STUDIO_CAROUSEL_PRIMARY_FILL,
  STUDIO_CAROUSEL_PRIMARY_PX,
  STUDIO_CAROUSEL_SECONDARY_FILL,
  STUDIO_CAROUSEL_SECONDARY_PX,
} from "@/lib/studio-carousel-text-style";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function slideCanvasStyleFromVision(
  v: VisionCarouselTextStyle
): SlideCanvasTextStyle {
  const accent =
    v.insetFrameStrokeHex && HEX6.test(v.insetFrameStrokeHex.trim())
      ? v.insetFrameStrokeHex.trim()
      : STUDIO_CAROUSEL_PRIMARY_FILL;

  return {
    textFill: STUDIO_CAROUSEL_PRIMARY_FILL,
    textFillPrimary: STUDIO_CAROUSEL_PRIMARY_FILL,
    textFillSecondary: STUDIO_CAROUSEL_SECONDARY_FILL,
    accentStroke: accent,
    outlineStroke: visionStrokeToCanvasRgba(v),
    outlineWidthScale: v.outlineThicknessScale,
    dropShadowStrength: v.dropShadowStrength,
    letterSpacingPrimaryEm: v.letterSpacingEm,
    letterSpacingSecondaryEm: v.letterSpacingEm,
    fontFamilyPrimary: "Anton",
    fontFamilySecondary: "Anton",
    fontSizePrimaryPx: STUDIO_CAROUSEL_PRIMARY_PX,
    fontSizeSecondaryPx: STUDIO_CAROUSEL_SECONDARY_PX,
    gapBeforeBodyPx: STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX,
    gapAfterTitlePx: STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX,
    referencePlacement: v.referencePlacement,
  };
}

export function visionStyleLlmAppendix(v: VisionCarouselTextStyle): string {
  return `### Carousel text style (from reference image: primary + secondary)\n${formatVisionStyleForLlmPrompt(v)}\n`;
}
