/**
 * Optional FFmpeg color tweaks after scale/crop (eq + hue + optional highlight lift).
 * Shared by carousel keyframes, background stills, and image-post frame.
 */

export type FrameColorAdjust = {
  /** FFmpeg `eq` brightness (-1…1, 0 = neutral). */
  brightness: number;
  /** FFmpeg `hue` angle in degrees. */
  hueDeg: number;
  /** FFmpeg `eq` saturation multiplier (1 = neutral). */
  saturation: number;
  /**
   * Highlight lift via `colorbalance` (equal rh/gh/bh, ~−0.45…0.45).
   * Positive brightens bright tones; negative pulls highlights down.
   */
  highlights: number;
};

export const DEFAULT_FRAME_COLOR_ADJUST: FrameColorAdjust = {
  brightness: 0,
  hueDeg: 0,
  saturation: 1,
  highlights: 0,
};

export function clampFrameColorAdjust(a: FrameColorAdjust): FrameColorAdjust {
  return {
    brightness: Math.min(1, Math.max(-1, a.brightness)),
    hueDeg: Math.min(180, Math.max(-180, a.hueDeg)),
    saturation: Math.min(2.5, Math.max(0.05, a.saturation)),
    highlights: Math.min(0.45, Math.max(-0.45, a.highlights)),
  };
}

export function isNeutralFrameColorAdjust(a: FrameColorAdjust): boolean {
  const c = clampFrameColorAdjust(a);
  return (
    Math.abs(c.brightness) < 1e-5 &&
    Math.abs(c.hueDeg) < 1e-5 &&
    Math.abs(c.saturation - 1) < 1e-4 &&
    Math.abs(c.highlights) < 1e-5
  );
}

/** After `coverCrop` geometry; omit when neutral. */
export function frameColorAdjustFilterChain(color: FrameColorAdjust): string {
  const c = clampFrameColorAdjust(color);
  const b = c.brightness.toFixed(5);
  const sat = c.saturation.toFixed(5);
  const h = c.hueDeg.toFixed(3);
  let chain = `eq=brightness=${b}:contrast=1:gamma=1:saturation=${sat},hue=h=${h}`;
  if (Math.abs(c.highlights) >= 1e-5) {
    const hi = c.highlights.toFixed(5);
    chain += `,colorbalance=rh=${hi}:gh=${hi}:bh=${hi}`;
  }
  return chain;
}

export function parseFrameColorAdjustJson(
  raw: string | undefined | null
): FrameColorAdjust | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  try {
    const o = JSON.parse(s) as unknown;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return undefined;
    const x = o as Record<string, unknown>;
    const brightness =
      typeof x.brightness === "number" && Number.isFinite(x.brightness)
        ? x.brightness
        : 0;
    const hueDeg =
      typeof x.hueDeg === "number" && Number.isFinite(x.hueDeg)
        ? x.hueDeg
        : typeof x.h === "number" && Number.isFinite(x.h)
          ? x.h
          : 0;
    const saturation =
      typeof x.saturation === "number" && Number.isFinite(x.saturation)
        ? x.saturation
        : 1;
    const highlights =
      typeof x.highlights === "number" && Number.isFinite(x.highlights)
        ? x.highlights
        : 0;
    return clampFrameColorAdjust({ brightness, hueDeg, saturation, highlights });
  } catch {
    return undefined;
  }
}

/** UI: brightness −100…100 → FFmpeg −0.5…0.5; highlights −100…100 → ±0.45 */
export function frameColorAdjustFromUiSliders(ui: {
  brightness: number;
  hue: number;
  saturation: number;
  highlights: number;
}): FrameColorAdjust {
  return clampFrameColorAdjust({
    brightness: Math.min(1, Math.max(-1, ui.brightness / 200)),
    hueDeg: Math.min(180, Math.max(-180, ui.hue)),
    saturation: Math.min(2.5, Math.max(0.05, ui.saturation / 100)),
    highlights: Math.min(
      0.45,
      Math.max(-0.45, (ui.highlights / 100) * 0.45)
    ),
  });
}

export function frameColorAdjustToUiSliders(
  a: FrameColorAdjust
): {
  brightness: number;
  hue: number;
  saturation: number;
  highlights: number;
} {
  const c = clampFrameColorAdjust(a);
  return {
    brightness: Math.round(c.brightness * 200),
    hue: Math.round(c.hueDeg),
    saturation: Math.round(c.saturation * 100),
    highlights: Math.round((c.highlights / 0.45) * 100),
  };
}

/**
 * CSS `filter` for a live browser preview (approximates FFmpeg eq + hue; export may differ slightly).
 */
export function frameColorAdjustToCssFilter(
  a: FrameColorAdjust
): string | undefined {
  if (isNeutralFrameColorAdjust(a)) return undefined;
  const c = clampFrameColorAdjust(a);
  // Highlights: approximate lift in bright tones (colorbalance has no CSS twin).
  const hiLift = Math.min(1.38, Math.max(0.72, 1 + c.highlights * 1.05));
  const brightness = Math.min(
    2.6,
    Math.max(0.22, (1 + c.brightness) * hiLift)
  );
  const satPct = Math.min(300, Math.max(0, c.saturation * 100));
  return `brightness(${brightness}) hue-rotate(${c.hueDeg}deg) saturate(${satPct}%)`;
}
