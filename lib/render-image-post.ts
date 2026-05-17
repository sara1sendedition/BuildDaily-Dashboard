import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as fs from "fs/promises";
import { buildHookCanvasLines } from "@/lib/image-post-hook-draw";
import { ensureSlideFonts } from "./fonts";
import type { ReferenceSlideTextStyle } from "@/lib/visual-reference-overlay";
import type { ImageHookOverlayStyle } from "@/lib/visual-reference-types";
import {
  IMAGE_POST_READ_CAPTION_PILL_BG,
  STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX,
  STUDIO_CAROUSEL_PRIMARY_FILL,
  STUDIO_CAROUSEL_PRIMARY_PX,
  STUDIO_CAROUSEL_SECONDARY_FILL,
  STUDIO_CAROUSEL_SECONDARY_PX,
} from "./studio-carousel-text-style";
import { CANONICAL_CAPTION_POINTERS, type BrandingPreset } from "./types";

const OUTLINE_COLOR = "rgba(0,0,0,0.92)";

/** Soft feathered glow behind glyphs (no solid panel). */
const FEATHER = {
  main: {
    blur: 36,
    offsetY: 4,
    color: "rgba(0,0,0,0.42)",
  },
  cta: {
    blur: 28,
    offsetY: 3,
    color: "rgba(0,0,0,0.38)",
  },
} as const;

const FRAME_INSET = 12;
const FRAME_STROKE_WIDTH = 4;
const INNER_PAD = 16;
const CONTENT_INSET =
  FRAME_INSET + FRAME_STROKE_WIDTH / 2 + INNER_PAD;

/** Match carousel Anton headline / subtitle sizing on 1080-wide canvas. */
const HOOK_MAIN_PX = STUDIO_CAROUSEL_PRIMARY_PX;
const HOOK_MAIN_LINE_HEIGHT = Math.round(
  (STUDIO_CAROUSEL_PRIMARY_PX * 72) / 60
);
const HOOK_MAIN_MAX_LINES = 4;

const HOOK_CTA_PX = STUDIO_CAROUSEL_SECONDARY_PX;
const HOOK_CTA_LINE_HEIGHT = Math.round(
  (STUDIO_CAROUSEL_SECONDARY_PX * 58) / 48
);
const HOOK_CTA_MAX_LINES = 3;
const GAP_MAIN_TO_CTA = STUDIO_CAROUSEL_HEADLINE_SUBTITLE_GAP_PX;

const READ_CAPTION_LABEL = "READ CAPTION";
const PILL_FONT_PX = 34;
const GAP_CTA_TO_PILL = 16;

const FONT_FAMILY_STACK = "Anton";

function wrapCtaLines(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    const m = ctx.measureText(test);
    if (m.width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines);
}

function drawOutlinedLine(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  line: string,
  x: number,
  y: number,
  outlineWidth: number,
  layer: "main" | "cta",
  textFill: string,
  outlineScale = 1
): void {
  const ow = Math.max(3, Math.round(outlineWidth * outlineScale));
  const f = FEATHER[layer];
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.save();
  ctx.shadowColor = f.color;
  ctx.shadowBlur = f.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = f.offsetY;
  ctx.fillStyle = textFill;
  ctx.fillText(line, x, y);
  ctx.restore();

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = ow;
  ctx.strokeText(line, x, y);
  ctx.fillStyle = textFill;
  ctx.fillText(line, x, y);
}

function outlineWidthForFont(px: number): number {
  return Math.max(5, Math.round(px * 0.14));
}

function roundRectPath(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function readCaptionPillMetrics(ctx: import("@napi-rs/canvas").SKRSContext2D): {
  pillW: number;
  pillH: number;
  labelW: number;
  arrowW: number;
  padX: number;
  innerGap: number;
} {
  ctx.save();
  ctx.font = `${PILL_FONT_PX}px ${FONT_FAMILY_STACK}`;
  const labelW = ctx.measureText(READ_CAPTION_LABEL).width;
  ctx.restore();
  const arrowW = Math.round(PILL_FONT_PX * 0.5);
  const innerGap = Math.round(PILL_FONT_PX * 0.32);
  const padX = Math.round(PILL_FONT_PX * 0.72);
  const pillH = Math.round(PILL_FONT_PX * 1.42);
  const innerW = labelW + innerGap + arrowW;
  const pillW = innerW + padX * 2;
  return { pillW, pillH, labelW, arrowW, padX, innerGap };
}

function fillDownArrowHead(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number
): void {
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.48, cy - h * 0.35);
  ctx.lineTo(cx + w * 0.48, cy - h * 0.35);
  ctx.lineTo(cx, cy + h * 0.45);
  ctx.closePath();
  ctx.fillStyle = "#000000";
  ctx.fill();
}

function drawReadCaptionPill(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  cx: number,
  centerY: number,
  metrics: ReturnType<typeof readCaptionPillMetrics>
): void {
  const { pillW, pillH, labelW, arrowW, padX, innerGap } = metrics;
  const left = cx - pillW / 2;
  const top = centerY - pillH / 2;

  ctx.save();
  ctx.fillStyle = IMAGE_POST_READ_CAPTION_PILL_BG;
  roundRectPath(ctx, left, top, pillW, pillH, pillH / 2);
  ctx.fill();

  ctx.font = `${PILL_FONT_PX}px ${FONT_FAMILY_STACK}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000000";
  const textX = left + padX;
  ctx.fillText(READ_CAPTION_LABEL, textX, centerY);

  const ax = textX + labelW + innerGap + arrowW / 2;
  fillDownArrowHead(ctx, ax, centerY, arrowW, Math.round(PILL_FONT_PX * 0.42));
  ctx.restore();
}

export async function renderImagePostToPng(
  framePath: string,
  hook: string,
  microCta: string,
  branding: BrandingPreset,
  outPath: string,
  dimensions: { width: number; height: number },
  overlayStyle?: ReferenceSlideTextStyle,
  hookOverlay?: ImageHookOverlayStyle | null
): Promise<void> {
  const buf = await renderImagePostToBuffer(
    framePath,
    hook,
    microCta,
    branding,
    dimensions,
    overlayStyle,
    hookOverlay
  );
  await fs.writeFile(outPath, buf);
}

const SUBLINE_HEX = /^#[0-9a-fA-F]{6}$/;

export async function renderImagePostToBuffer(
  framePath: string,
  hook: string,
  microCta: string,
  _branding: BrandingPreset,
  dimensions: { width: number; height: number },
  /** Kept for API compatibility; image post fills match studio carousel (not profile textFill). */
  _overlayStyle?: ReferenceSlideTextStyle,
  hookOverlay?: ImageHookOverlayStyle | null
): Promise<Buffer> {
  const { width, height } = dimensions;
  const textWrapWidth = width - 2 * CONTENT_INSET;

  ensureSlideFonts(FONT_FAMILY_STACK, FONT_FAMILY_STACK);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const img = await loadImage(await fs.readFile(framePath));
  ctx.drawImage(img, 0, 0, width, height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = `${HOOK_MAIN_PX}px ${FONT_FAMILY_STACK}`;
  const letterEm = hookOverlay?.letterSpacingEm;
  if (letterEm !== undefined && Number.isFinite(letterEm)) {
    ctx.letterSpacing = `${letterEm * HOOK_MAIN_PX}px`;
  }

  const mainLines = buildHookCanvasLines(
    hook,
    ctx,
    textWrapWidth,
    HOOK_MAIN_MAX_LINES,
    STUDIO_CAROUSEL_PRIMARY_FILL,
    hookOverlay ?? undefined
  );

  if (letterEm !== undefined && Number.isFinite(letterEm)) {
    ctx.letterSpacing = "0px";
  }

  const subline =
    microCta.trim() ||
    CANONICAL_CAPTION_POINTERS[2] ||
    "Cues below";

  const sublineHex = hookOverlay?.sublineFill?.trim();
  const subFill =
    sublineHex && SUBLINE_HEX.test(sublineHex)
      ? sublineHex
      : STUDIO_CAROUSEL_SECONDARY_FILL;

  ctx.font = `${HOOK_CTA_PX}px ${FONT_FAMILY_STACK}`;
  const ctaLines = wrapCtaLines(
    ctx,
    subline,
    textWrapWidth,
    HOOK_CTA_MAX_LINES
  );

  const hasPill = mainLines.length > 0 || ctaLines.length > 0;
  const pillMetrics = hasPill ? readCaptionPillMetrics(ctx) : null;
  const pillBlockH =
    hasPill && pillMetrics ? GAP_CTA_TO_PILL + pillMetrics.pillH : 0;

  const mainBlockH = mainLines.length * HOOK_MAIN_LINE_HEIGHT;
  const ctaBlockH = ctaLines.length * HOOK_CTA_LINE_HEIGHT;
  const betweenGap =
    mainLines.length > 0 && ctaLines.length > 0 ? GAP_MAIN_TO_CTA : 0;
  const blockH = mainBlockH + betweenGap + ctaBlockH + pillBlockH;

  /** Vertically center headline + subline block */
  let blockTop = (height - blockH) / 2;

  const oxMain = outlineWidthForFont(HOOK_MAIN_PX);
  const oxCta = outlineWidthForFont(HOOK_CTA_PX);
  const hookOutlineScale =
    hookOverlay?.hookOutlineScale !== undefined &&
    Number.isFinite(hookOverlay.hookOutlineScale) &&
    hookOverlay.hookOutlineScale > 0
      ? Math.min(2.5, Math.max(0.5, hookOverlay.hookOutlineScale))
      : 1;

  ctx.font = `${HOOK_MAIN_PX}px ${FONT_FAMILY_STACK}`;
  if (letterEm !== undefined && Number.isFinite(letterEm)) {
    ctx.letterSpacing = `${letterEm * HOOK_MAIN_PX}px`;
  }
  for (const row of mainLines) {
    const cy = blockTop + HOOK_MAIN_LINE_HEIGHT / 2;
    drawOutlinedLine(
      ctx,
      row.text,
      width / 2,
      cy,
      oxMain,
      "main",
      row.fill,
      hookOutlineScale
    );
    blockTop += HOOK_MAIN_LINE_HEIGHT;
  }
  if (letterEm !== undefined && Number.isFinite(letterEm)) {
    ctx.letterSpacing = "0px";
  }

  if (mainLines.length > 0 && ctaLines.length > 0) {
    blockTop += GAP_MAIN_TO_CTA;
  }

  ctx.font = `${HOOK_CTA_PX}px ${FONT_FAMILY_STACK}`;
  for (const line of ctaLines) {
    const cy = blockTop + HOOK_CTA_LINE_HEIGHT / 2;
    drawOutlinedLine(ctx, line, width / 2, cy, oxCta, "cta", subFill);
    blockTop += HOOK_CTA_LINE_HEIGHT;
  }

  if (hasPill && pillMetrics) {
    const pillCy = blockTop + GAP_CTA_TO_PILL + pillMetrics.pillH / 2;
    drawReadCaptionPill(ctx, width / 2, pillCy, pillMetrics);
  }

  return canvas.toBuffer("image/png");
}
