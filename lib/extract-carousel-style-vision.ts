/**
 * OpenAI vision: infer carousel overlay typography from a reference image (e.g. text on photo).
 * Aligns with carousel **primary** (headline) vs **secondary** (body / supporting) text roles.
 */

import * as fs from "fs/promises";
import OpenAI from "openai";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  normalizeHorizontal,
  normalizeVertical,
} from "@/lib/reference-text-layout";
import type { ReferenceTextPlacement } from "@/lib/slide-canvas-types";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export type VisionFontWeight = "regular" | "semibold" | "bold";

export type VisionCarouselTextStyle = {
  /** Primary carousel text: headline / hook / largest overlay (#RRGGBB). */
  primaryTextFillHex: string;
  /**
   * Secondary carousel text: supporting line under the headline, smaller copy (#RRGGBB).
   * Same as primary when the design is single-color; otherwise the second fill.
   */
  secondaryTextFillHex: string | null;
  /** Main text outline / stroke (hex). */
  textStrokeHex: string | null;
  /** 0–1 opacity for stroke color when compositing to rgba. */
  textStrokeAlpha01: number;
  /** Scales default outline width (~0.55–1.85). */
  outlineThicknessScale: number;
  dropShadowStrength: "none" | "light" | "medium" | "heavy";
  /** Rounded inset frame on slides, if visible in reference; else null. */
  insetFrameStrokeHex: string | null;
  /** Weight for primary (headline-sized) lines. */
  fontWeightPrimary: VisionFontWeight;
  /** Weight for secondary (body-sized) lines. */
  fontWeightSecondary: VisionFontWeight;
  letterSpacingEm: number;
  /** Short note for LLM (serif/sans, mood). */
  detectedFontVibe: string;
  /** Where primary + secondary text sit on the canvas (match reference image). */
  referencePlacement: ReferenceTextPlacement;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeHex6(s: string | undefined | null): string | null {
  const t = (s ?? "").trim();
  if (!HEX6.test(t)) return null;
  return t;
}

function hex6ToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${clamp(alpha, 0, 1)})`;
  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);
  const a = clamp(alpha, 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}

export function visionStrokeToCanvasRgba(style: VisionCarouselTextStyle): string {
  const hex = normalizeHex6(style.textStrokeHex) ?? "#000000";
  const a =
    typeof style.textStrokeAlpha01 === "number" && Number.isFinite(style.textStrokeAlpha01)
      ? style.textStrokeAlpha01
      : 0.92;
  return hex6ToRgba(hex, clamp(a, 0.35, 1));
}

const WEIGHT_MAP = {
  regular: "Poppins",
  semibold: "Poppins SemiBold",
  bold: "Poppins Bold",
} as const;

export function visionFontFamilyForWeight(w: VisionFontWeight): string {
  return WEIGHT_MAP[w] ?? WEIGHT_MAP.regular;
}

/**
 * Appended to carousel LLM prompts so slide copy can match the vibe.
 */
export function formatVisionStyleForLlmPrompt(v: VisionCarouselTextStyle): string {
  const dual =
    v.secondaryTextFillHex &&
    v.secondaryTextFillHex.toLowerCase() !== v.primaryTextFillHex.toLowerCase()
      ? `Primary (headline) fill: ${v.primaryTextFillHex}; secondary (body/supporting) fill: ${v.secondaryTextFillHex}`
      : `Single overlay text fill: ${v.primaryTextFillHex}`;
  return [
    dual,
    `Stroke: ${v.textStrokeHex ?? "(not distinct)"} alpha≈${v.textStrokeAlpha01.toFixed(2)}`,
    `Outline thickness scale vs default: ${v.outlineThicknessScale.toFixed(2)}`,
    `Drop shadow: ${v.dropShadowStrength}`,
    v.insetFrameStrokeHex
      ? `Inset frame / border stroke color: ${v.insetFrameStrokeHex}`
      : "Inset frame: not clearly matched from reference.",
    `Font weight primary / secondary (Poppins mapping): ${v.fontWeightPrimary} / ${v.fontWeightSecondary}`,
    `Letter-spacing (em, primary + secondary lines): ${v.letterSpacingEm.toFixed(3)}`,
    `Font / layout vibe: ${v.detectedFontVibe}`,
    `Text block placement: vertical=${v.referencePlacement.vertical} horizontal=${v.referencePlacement.horizontal}${
      v.referencePlacement.textBlockCenterYNorm != null
        ? ` yCenterNorm=${v.referencePlacement.textBlockCenterYNorm.toFixed(2)}`
        : ""
    }${
      v.referencePlacement.textBlockCenterXNorm != null
        ? ` xCenterNorm=${v.referencePlacement.textBlockCenterXNorm.toFixed(2)}`
        : ""
    }`,
  ].join("\n");
}

async function imagePathToJpegBase64(
  imagePath: string,
  maxEdge = 1280
): Promise<{ base64: string; mime: "image/jpeg" }> {
  const buf = await fs.readFile(imagePath);
  const img = await loadImage(buf);
  const nw = img.width;
  const nh = img.height;
  const scale = Math.min(1, maxEdge / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = await canvas.encode("jpeg", 85);
  return { base64: Buffer.from(jpeg).toString("base64"), mime: "image/jpeg" };
}

function parseOptionalNorm01(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return clamp(n, 0, 1);
}

function parseReferencePlacement(o: Record<string, unknown>): ReferenceTextPlacement {
  return {
    vertical: normalizeVertical(
      String(o.textBlockVertical ?? o.textVertical ?? o.verticalBand ?? "")
    ),
    horizontal: normalizeHorizontal(
      String(o.textBlockHorizontal ?? o.textHorizontal ?? o.horizontalAlign ?? "")
    ),
    textBlockCenterYNorm: parseOptionalNorm01(o.textBlockCenterYNorm),
    textBlockCenterXNorm: parseOptionalNorm01(o.textBlockCenterXNorm),
  };
}

function parseFontWeight(o: Record<string, unknown>, ...keys: string[]): VisionFontWeight {
  for (const k of keys) {
    const raw = o[k];
    if (raw === undefined || raw === null) continue;
    const v = String(raw).toLowerCase();
    if (v === "regular" || v === "normal") return "regular";
    if (v === "semibold" || v === "semi_bold" || v === "600") return "semibold";
    if (v === "bold" || v === "700") return "bold";
  }
  return "bold";
}

function parseVisionJson(raw: string): VisionCarouselTextStyle | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const fill = normalizeHex6(String(o.primaryTextFillHex ?? ""));
  if (!fill) return null;

  const secondaryRaw =
    o.secondaryTextFillHex ??
    o.subtextTextFillHex ??
    o.bodyTextFillHex ??
    o.supportingTextFillHex;
  let secondaryTextFillHex: string | null = null;
  if (secondaryRaw !== null && secondaryRaw !== undefined) {
    const sh = normalizeHex6(String(secondaryRaw));
    if (sh && sh.toLowerCase() !== fill.toLowerCase()) secondaryTextFillHex = sh;
  }

  const strokeHex =
    o.textStrokeHex === null || o.textStrokeHex === undefined
      ? null
      : normalizeHex6(String(o.textStrokeHex));

  const alphaRaw = Number(o.textStrokeAlpha01);
  const textStrokeAlpha01 = Number.isFinite(alphaRaw)
    ? clamp(alphaRaw, 0, 1)
    : 0.92;

  const scaleRaw = Number(o.outlineThicknessScale);
  const outlineThicknessScale = Number.isFinite(scaleRaw)
    ? clamp(scaleRaw, 0.45, 2.2)
    : 1;

  const dss = String(o.dropShadowStrength ?? "medium").toLowerCase();
  const dropShadowStrength =
    dss === "none" || dss === "light" || dss === "heavy" || dss === "medium"
      ? (dss as VisionCarouselTextStyle["dropShadowStrength"])
      : "medium";

  const insetRaw = o.insetFrameStrokeHex;
  const insetFrameStrokeHex =
    insetRaw === null || insetRaw === undefined
      ? null
      : normalizeHex6(String(insetRaw));

  const fontWeightPrimary = parseFontWeight(
    o,
    "fontWeightPrimary",
    "fontWeightTitle"
  );
  const fontWeightSecondary = parseFontWeight(
    o,
    "fontWeightSecondary",
    "fontWeightBody"
  );

  const lsRaw = Number(o.letterSpacingEm);
  const letterSpacingEm = Number.isFinite(lsRaw) ? clamp(lsRaw, -0.08, 0.2) : 0;

  const detectedFontVibe =
    String(o.detectedFontVibe ?? "").trim().slice(0, 400) ||
    "Bold sans-serif social overlay; match general weight to reference.";

  const referencePlacement = parseReferencePlacement(o);

  return {
    primaryTextFillHex: fill,
    secondaryTextFillHex,
    textStrokeHex: strokeHex,
    textStrokeAlpha01,
    outlineThicknessScale,
    dropShadowStrength,
    insetFrameStrokeHex,
    fontWeightPrimary,
    fontWeightSecondary,
    letterSpacingEm,
    detectedFontVibe,
    referencePlacement,
  };
}

/**
 * Calls gpt-4o-mini with the image. Requires a valid API key.
 */
export async function extractCarouselTextStyleFromImagePath(
  imagePath: string,
  apiKey: string
): Promise<VisionCarouselTextStyle> {
  const { base64, mime } = await imagePathToJpegBase64(imagePath);
  const openai = new OpenAI({ apiKey });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You analyze social graphics with text overlays for a **carousel** (slides have primary headline text and optional secondary body text, like Instagram carousels).

Return JSON ONLY with keys:
primaryTextFillHex (string #RRGGBB — fill for the **primary** line: largest headline / hook / top overlay),
secondaryTextFillHex (string #RRGGBB or null — fill for **secondary** text: smaller supporting line under the primary, or separate body line; null only if every visible overlay line uses the same fill),
textStrokeHex (string #RRGGBB or null if no clear separate stroke),
textStrokeAlpha01 (number 0-1 for stroke opacity; ~0.85-0.95 for dark strokes),
outlineThicknessScale (number 0.45-2.2 vs typical bold social text),
dropShadowStrength ("none"|"light"|"medium"|"heavy"),
insetFrameStrokeHex (#RRGGBB or null if no visible rounded border framing the canvas),
fontWeightPrimary ("regular"|"semibold"|"bold" — weight for primary/headline-sized text),
fontWeightSecondary ("regular"|"semibold"|"bold" — weight for secondary/body-sized text),
letterSpacingEm (number -0.08 to 0.2; applies to both roles unless clearly different; then prefer primary),
detectedFontVibe (short string: sans/serif/rounded/condensed + mood),
textBlockVertical ("top"|"upper"|"center"|"lower"|"bottom" — vertical band where the **stack** of primary+secondary text sits in the reference),
textBlockHorizontal ("left"|"center"|"right" — horizontal alignment of that text stack),
textBlockCenterYNorm (optional number 0-1 — vertical center of the text cluster; use when finer than the band, e.g. 0.22 for near-top),
textBlockCenterXNorm (optional number 0-1 — horizontal center when textBlockHorizontal is "center"; nudges off-center clusters).

CRITICAL: Match carousel roles — primary = main hook; secondary = subline or body. If two distinct fills exist (e.g. yellow primary + white secondary), set both hexes. **Placement** must match where the creator placed the overlay block on the reference (not generic centered slides). Sample colors from letterforms, not background. Ignore non-creator UI chrome.

Legacy aliases also accepted if present: subtextTextFillHex, fontWeightTitle, fontWeightBody.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Infer typography and **text block position** for carousel slides (primary/secondary fills + textBlockVertical/Horizontal to match where text sits on this reference).",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mime};base64,${base64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseVisionJson(raw);
  if (!parsed) {
    throw new Error("Could not parse carousel style from vision model.");
  }
  return parsed;
}
