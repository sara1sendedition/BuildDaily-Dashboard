/**
 * Derive canvas text/frame colors from a stored visual reference profile.
 */

import type { SlideCanvasTextStyle } from "@/lib/slide-canvas-types";
import type { VisualReferenceProfile } from "@/lib/visual-reference-types";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** @deprecated Use {@link SlideCanvasTextStyle} */
export type ReferenceSlideTextStyle = SlideCanvasTextStyle;

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const rs = parseInt(m[1]!, 16) / 255;
  const gs = parseInt(m[2]!, 16) / 255;
  const bs = parseInt(m[3]!, 16) / 255;
  const lin = (u: number) =>
    u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  const r = lin(rs);
  const g = lin(gs);
  const b = lin(bs);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick text and accent colors for slide / image-post overlays.
 * Honors manual `typography.fontColorHex` when valid; otherwise light text on
 * darker frames and dark text on very bright mean-luma frames.
 */
export function deriveOverlayColorsFromProfile(
  profile: VisualReferenceProfile | null | undefined
): SlideCanvasTextStyle | undefined {
  if (!profile) return undefined;
  const manual = profile.typography.fontColorHex?.trim();
  if (manual && HEX6.test(manual)) {
    const accent =
      profile.palette.swatches[0]?.hex && HEX6.test(profile.palette.swatches[0].hex)
        ? profile.palette.swatches[0].hex
        : manual;
    return { textFill: manual, accentStroke: accent };
  }
  const luma = profile.colorTone.exposureMeanLuma01;
  const darkText = luma != null && luma > 0.58;
  const textFill = darkText ? "#141414" : "#ffffff";
  const sw = profile.palette.swatches.find((s) => s.hex && HEX6.test(s.hex));
  let accentStroke = sw?.hex ?? textFill;
  if (darkText && accentStroke.toLowerCase() === "#141414") {
    accentStroke = sw?.hex && HEX6.test(sw.hex) ? sw.hex : "#f5f5f4";
  }
  if (!darkText && relativeLuminance(accentStroke) < 0.35) {
    accentStroke = "#f5f5f4";
  }
  return { textFill, accentStroke };
}
