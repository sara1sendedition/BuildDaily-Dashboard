/**
 * Default on-canvas typography for the main Video Studio carousel tool.
 * Sizes and headline–subtitle gap are tuned to match the product reference still
 * (Anton headline #ffde59, Anton subtitle white, tight vertical rhythm).
 */

import type { SlideCanvasTextStyle } from "@/lib/slide-canvas-types";

export const STUDIO_CAROUSEL_PRIMARY_PX = 78;
export const STUDIO_CAROUSEL_SECONDARY_PX = 57;
export const STUDIO_CAROUSEL_PRIMARY_FILL = "#ffde59";
export const STUDIO_CAROUSEL_SECONDARY_FILL = "#ffffff";

/**
 * Vertical gap (px) between the last headline line and the first subtitle line.
 * ~12% of 78px primary cap height — matches reference banner where outlines sit close.
 */
export const STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX = 10;

/** Image-post “READ CAPTION” pill background (matches feed reference). */
export const IMAGE_POST_READ_CAPTION_PILL_BG = "#ffea99";

export function studioDefaultSlideCanvasTextStyle(): SlideCanvasTextStyle {
  return {
    textFill: STUDIO_CAROUSEL_PRIMARY_FILL,
    textFillPrimary: STUDIO_CAROUSEL_PRIMARY_FILL,
    textFillSecondary: STUDIO_CAROUSEL_SECONDARY_FILL,
    accentStroke: STUDIO_CAROUSEL_PRIMARY_FILL,
    fontFamilyPrimary: "Anton",
    fontFamilySecondary: "Anton",
    fontSizePrimaryPx: STUDIO_CAROUSEL_PRIMARY_PX,
    fontSizeSecondaryPx: STUDIO_CAROUSEL_SECONDARY_PX,
    gapBeforeBodyPx: STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX,
    gapAfterTitlePx: STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX,
  };
}

/** Keep studio typography; use saved visual reference only for frame/chevron accent stroke. */
export function mergedStudioSlideStyleWithProfileAccent(
  profileStyle: SlideCanvasTextStyle | undefined
): SlideCanvasTextStyle {
  const base = studioDefaultSlideCanvasTextStyle();
  if (!profileStyle) return base;
  return { ...base, accentStroke: profileStyle.accentStroke };
}
