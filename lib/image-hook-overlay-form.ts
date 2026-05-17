import type { ImageHookOverlayStyle } from "@/lib/visual-reference-types";

/** Parse Visual references form fields into `imageHookOverlay` (or `undefined` if empty). */
export function parseImageHookOverlayFromForm(
  fills: string,
  letterEm: string,
  outlineScale: string,
  sublineHex: string
): ImageHookOverlayStyle | undefined {
  const hookLineFills = fills
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^#[0-9a-fA-F]{6}$/.test(s));
  const le = letterEm.trim().replace(",", ".");
  const letterSpacingEm = parseFloat(le);
  const os = outlineScale.trim().replace(",", ".");
  const hookOutlineScale = parseFloat(os);
  const sub = sublineHex.trim();
  const sublineFill = /^#[0-9a-fA-F]{6}$/.test(sub) ? sub : undefined;

  const o: ImageHookOverlayStyle = {};
  if (hookLineFills.length > 0) o.hookLineFills = hookLineFills;
  if (le && Number.isFinite(letterSpacingEm)) o.letterSpacingEm = letterSpacingEm;
  if (os && Number.isFinite(hookOutlineScale) && hookOutlineScale > 0) {
    o.hookOutlineScale = Math.min(2.5, Math.max(0.5, hookOutlineScale));
  }
  if (sublineFill) o.sublineFill = sublineFill;
  return Object.keys(o).length > 0 ? o : undefined;
}
