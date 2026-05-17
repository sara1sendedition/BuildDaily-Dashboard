/**
 * Parse client-sent visual reference JSON and format for LLM / pipeline context.
 */

import type { VisualReferenceProfile } from "@/lib/visual-reference-types";

const MAX_JSON_CHARS = 48_000;
const MAX_MANUAL_MD_IN_PROMPT = 4_000;

export function parseVisualReferenceProfileJson(
  raw: string | undefined | null,
  maxChars = MAX_JSON_CHARS
): VisualReferenceProfile | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > maxChars) return null;
  try {
    const o = JSON.parse(t) as unknown;
    if (typeof o !== "object" || o === null) return null;
    const p = o as Partial<VisualReferenceProfile>;
    if (p.schemaVersion !== 1) return null;
    if (p.kind !== "carousel" && p.kind !== "photo" && p.kind !== "image") {
      return null;
    }
    if (!p.colorTone || typeof p.colorTone !== "object") return null;
    return p as VisualReferenceProfile;
  } catch {
    return null;
  }
}

function fmt(n: number | null | undefined, d = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}

/** Compact block for chat prompts (carousel / image / photo). */
export function formatVisualReferenceForLlm(p: VisualReferenceProfile): string {
  const ct = p.colorTone;
  const lines: string[] = [];
  lines.push(`[Visual reference · kind=${p.kind} · file=${p.fileName}]`);
  lines.push(
    `Color/tone: mean_luma=${fmt(ct.exposureMeanLuma01)} black=${fmt(ct.blackPointLuma01)} white=${fmt(ct.whitePointLuma01)} spread=${fmt(ct.tonalSpread01)} sat_index=${fmt(ct.saturationIndex01)} vibrance_proxy=${fmt(ct.vibranceVsSaturationProxy)} kelvin=${ct.colorTemperatureKelvin ? Math.round(ct.colorTemperatureKelvin) : "n/a"} (reliable=${ct.colorTemperatureReliable}) tint_a*=${fmt(ct.tintGreenMagentaAstar, 1)}`
  );
  if (p.palette.swatches.length) {
    lines.push(
      `Palette: ${p.palette.swatches.map((s) => `${s.hex}(${(s.weight * 100).toFixed(0)}%)`).join(", ")}`
    );
  }
  lines.push(
    `Gradient: ${p.gradient.detected ? "yes" : "no"} strength=${fmt(p.gradient.strength01)} dir=${p.gradient.direction}; background guess=${p.background.type} / image_style=${p.background.imageStyle}`
  );
  lines.push(
    `Composition: aspect≈${p.composition.aspectRatioLabel} (${p.composition.aspectRatio.toFixed(3)}), balance=${p.composition.balance}, text_region_likelihood=${fmt(p.composition.textRegionLikelihood01)}`
  );
  lines.push(
    `Technical: ${p.technical.widthPx}×${p.technical.heightPx}px, safe_inset≈${(p.technical.safeAreaInsetFraction * 100).toFixed(0)}%`
  );
  if (p.imageHookOverlay && Object.keys(p.imageHookOverlay as object).length > 0) {
    const io = p.imageHookOverlay;
    lines.push(
      `Image hook overlay: fills=${(io.hookLineFills ?? []).join(",") || "default"} letterSpacingEm=${io.letterSpacingEm ?? "n/a"} outlineScale=${io.hookOutlineScale ?? 1} sublineFill=${io.sublineFill ?? "default"}`
    );
  }
  if (p.referenceOcr) {
    const o = p.referenceOcr;
    lines.push(
      `OCR (Tesseract, browser): mean_conf=${fmt(o.meanConfidence / 100, 2)} lines=${o.lineLengthStats.lineCount} max_chars=${o.lineLengthStats.maxChars} median_chars=${o.lineLengthStats.medianChars} hook_guess=${o.hookFormatGuess}`
    );
    if (o.marginsNorm) {
      lines.push(
        `OCR text margins (norm): top=${fmt(o.marginsNorm.top)} left=${fmt(o.marginsNorm.left)} right=${fmt(o.marginsNorm.right)} bottom=${fmt(o.marginsNorm.bottom)}`
      );
    }
    const c = o.ctaHints;
    lines.push(
      `OCR CTA flags: caption=${c.mentionsCaption} swipe=${c.mentionsSwipe} link=${c.mentionsLink} save=${c.mentionsSave} follow=${c.mentionsFollow}`
    );
    const f = o.fontFromEngine;
    lines.push(
      `OCR font engine: median_size_px=${f.medianFontSizePx ?? "n/a"} bold_majority=${f.boldMajority ?? "n/a"} serif_majority=${f.serifMajority ?? "n/a"} names=${(f.engineFontNames ?? []).slice(0, 5).join("|") || "none"}`
    );
    lines.push(`OCR limits: ${f.disclaimer}`);
    lines.push(`Layout limits (manual / not OCR): ${o.layoutDocumentation.logoPlacement}`);
    lines.push(`Grid note: ${o.layoutDocumentation.grid}`);
    lines.push(`Stroke/shadow note: ${o.layoutDocumentation.strokeShadow}`);
    const preview = o.rawText.replace(/\s+/g, " ").trim().slice(0, 400);
    if (preview) {
      lines.push(`OCR text preview: ${preview}${o.rawText.length > 400 ? "…" : ""}`);
    }
  }
  const notes = p.manualNotes?.trim();
  if (notes) {
    lines.push(`Creator short notes: ${notes}`);
  }
  const ext = p.manualExtendedMarkdown?.trim();
  if (ext) {
    lines.push("Creator extended spec (markdown, truncated):");
    lines.push(ext.slice(0, MAX_MANUAL_MD_IN_PROMPT));
    if (ext.length > MAX_MANUAL_MD_IN_PROMPT) {
      lines.push("…(truncated)");
    }
  }
  return lines.join("\n");
}

export function joinVisualReferencePrompts(
  blocks: (string | null | undefined)[]
): string {
  const parts = blocks
    .map((b) => (typeof b === "string" ? b.trim() : ""))
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts.join("\n\n---\n\n");
}
