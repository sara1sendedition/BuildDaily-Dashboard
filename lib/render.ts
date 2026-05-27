import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as fs from "fs/promises";
import { ensureSlideFonts } from "./fonts";
import type { BrandingPreset } from "./types";
import type { LayoutId } from "./types";
import type { SlidePlan } from "./types";
import {
  FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS,
  truncateHeadlineAtWordBoundary,
} from "./carousel-slide-limits";
import { resolveReferenceTextAnchor } from "./reference-text-layout";
import type { ReferenceTextPlacement, SlideCanvasTextStyle } from "./slide-canvas-types";

export type { SlideCanvasTextStyle };

/** Readable on any frame without a dimming overlay */
const TEXT_FILL = "#ffffff";

/** Legacy layout: inner margin from canvas edge (matches former frame padding). */
const FRAME_INSET = 12;
const FRAME_STROKE_WIDTH = 4;
/** Space between inner edge of frame stroke and text / bottom controls. */
const INNER_PAD = 16;
/** Total horizontal/vertical margin from canvas edge to safe content (inside frame). */
const CONTENT_INSET =
  FRAME_INSET + FRAME_STROKE_WIDTH / 2 + INNER_PAD;

/** Pixel dimensions for one rendered slide (e.g. 1080×1080 YouTube, 1080×1350 Instagram 4:5). */
export type RenderDimensions = { width: number; height: number };
const OUTLINE_COLOR = "rgba(0,0,0,0.92)";
/** Soft drop shadow behind slide text (scales with outline weight). */
const TEXT_SHADOW = {
  color: "rgba(0,0,0,0.9)",
  blurFactor: 2.45,
  offsetXFactor: 0.52,
  offsetYFactor: 0.82,
} as const;

function wrapLines(
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

/** Matches "1." / "1)" at start of a line or segment (listical / step copy). */
const NUM_LIST_ITEM_START = /^\d+[\.\)]\s/;

/**
 * If text looks like a numbered list (2+ items), returns each item string.
 * Supports newline-separated lines or inline "1. A 2. B 3. C".
 */
function extractNumericListItems(text: string): string[] | null {
  const t = text.trim();
  if (!t) return null;

  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => NUM_LIST_ITEM_START.test(l))) {
    return lines;
  }

  /** "1. A, 2. B, 3. C" → same as spaced numbers for splitting */
  const normalized = t.replace(/,\s*(?=\d+[\.\)]\s)/g, " ");

  if (!NUM_LIST_ITEM_START.test(normalized)) return null;

  const parts = normalized
    .split(/\s+(?=\d+[\.\)]\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts;
  return null;
}

const LIST_ITEM_GAP_EXTRA_PX = 10;

type DrawLine = { text: string; extraGapAfter: boolean };

/**
 * Wraps plain text, or splits numbered lists into lines with gaps between items.
 */
function wrapLinesOrNumericList(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  text: string,
  maxWidth: number,
  maxTotalLines: number
): DrawLine[] {
  const items = extractNumericListItems(text);
  if (!items) {
    return wrapLines(ctx, text, maxWidth, maxTotalLines).map((line) => ({
      text: line,
      extraGapAfter: false,
    }));
  }

  const out: DrawLine[] = [];
  let lineBudget = maxTotalLines;
  for (let i = 0; i < items.length && lineBudget > 0; i++) {
    const wrapped = wrapLines(ctx, items[i], maxWidth, lineBudget);
    lineBudget -= wrapped.length;
    for (let j = 0; j < wrapped.length; j++) {
      const isLastWrappedOfItem = j === wrapped.length - 1;
      const isLastItem = i === items.length - 1;
      out.push({
        text: wrapped[j],
        extraGapAfter: isLastWrappedOfItem && !isLastItem,
      });
    }
  }
  return out;
}

function dropShadowMult(
  s: SlideCanvasTextStyle["dropShadowStrength"] | undefined
): number {
  switch (s) {
    case "none":
      return 0;
    case "light":
      return 0.52;
    case "heavy":
      return 1.35;
    case "medium":
    default:
      return 1;
  }
}

/** Stroke then fill so text stays readable on bright or busy backgrounds */
function drawOutlinedLine(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  line: string,
  x: number,
  y: number,
  outlineWidth: number,
  textFill: string = TEXT_FILL,
  opts?: { outlineColor?: string; shadowMult?: number }
): void {
  const outlineColor = opts?.outlineColor ?? OUTLINE_COLOR;
  const shadowMult = opts?.shadowMult ?? 1;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const blur = Math.max(14, Math.round(outlineWidth * TEXT_SHADOW.blurFactor));
  const ox = Math.max(4, Math.round(outlineWidth * TEXT_SHADOW.offsetXFactor));
  const oy = Math.max(7, Math.round(outlineWidth * TEXT_SHADOW.offsetYFactor));

  if (shadowMult > 0.04) {
    ctx.save();
    ctx.shadowColor = TEXT_SHADOW.color;
    ctx.shadowBlur = Math.round(blur * shadowMult);
    ctx.shadowOffsetX = Math.round(ox * shadowMult);
    ctx.shadowOffsetY = Math.round(oy * shadowMult);
    ctx.fillStyle = textFill;
    ctx.fillText(line, x, y);
    ctx.restore();
  } else {
    ctx.fillStyle = textFill;
    ctx.fillText(line, x, y);
  }

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outlineWidth;
  ctx.strokeText(line, x, y);
  ctx.fillStyle = textFill;
  ctx.fillText(line, x, y);
}

function outlineWidthForFont(px: number): number {
  return Math.max(5, Math.round(px * 0.14));
}

/**
 * One rounded chevron “>”; tip at `tipX` (right). Stroke + white fill for contrast on video.
 */
function drawSingleChevron(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  tipX: number,
  centerY: number,
  span: number,
  arm: number,
  innerFill: string = TEXT_FILL,
  outerStrokeColor: string = OUTLINE_COLOR
): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const outerW = Math.max(12, span * 0.2);
  const innerW = Math.max(6, outerW * 0.48);
  const drawStroke = (width: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(tipX - span, centerY - arm);
    ctx.lineTo(tipX, centerY);
    ctx.lineTo(tipX - span, centerY + arm);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  drawStroke(outerW, outerStrokeColor);
  drawStroke(innerW, innerFill);
}

/**
 * Double chevron (fast-forward style): two parallel “>>”, white fill with dark outline.
 * `tipX` is the right tip of the rightmost chevron.
 */
function drawDoubleChevronRight(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  tipX: number,
  centerY: number,
  span: number,
  arm: number,
  innerFill: string = TEXT_FILL,
  outerStrokeColor: string = OUTLINE_COLOR
): void {
  const gapBetween = Math.max(10, Math.round(span * 0.14));
  const leftTipX = tipX - span - gapBetween;
  drawSingleChevron(ctx, leftTipX, centerY, span, arm, innerFill, outerStrokeColor);
  drawSingleChevron(ctx, tipX, centerY, span, arm, innerFill, outerStrokeColor);
}

/** Horizontal extent from left tail to right tip (for counter layout). */
function doubleChevronTotalWidth(span: number): number {
  const gapBetween = Math.max(10, Math.round(span * 0.14));
  return 2 * span + gapBetween;
}

/**
 * Default slide typography (canvas px).
 * Body is intentionally large + SemiBold so it reads clearly vs the hook (Bold).
 */
const FONT = {
  stackedCenter: {
    title: 60,
    titleLineHeight: 72,
    body: 48,
    bodyLineHeight: 58,
    gapBeforeBody: 16,
  },
  lowerThird: {
    title: 55,
    titleLineHeight: 66,
    body: 42,
    bodyLineHeight: 52,
    gapAfterTitle: 12,
  },
  counter: 26,
} as const;

type StackedCarouselMetrics = {
  titlePx: number;
  bodyPx: number;
  titleLineHeight: number;
  bodyLineHeight: number;
  gapBeforeBody: number;
};

/** Stacked / reference text metrics; optional slide style overrides title/body px. */
function resolveStackedCarouselMetrics(
  slideStyle?: SlideCanvasTextStyle
): StackedCarouselMetrics {
  const f = FONT.stackedCenter;
  const titlePx = slideStyle?.fontSizePrimaryPx ?? f.title;
  const bodyPx = slideStyle?.fontSizeSecondaryPx ?? f.body;
  return {
    titlePx,
    bodyPx,
    titleLineHeight: Math.round((titlePx * f.titleLineHeight) / f.title),
    bodyLineHeight: Math.round((bodyPx * f.bodyLineHeight) / f.body),
    gapBeforeBody:
      slideStyle?.gapBeforeBodyPx ??
      Math.round((f.gapBeforeBody * bodyPx) / f.body),
  };
}

type LowerThirdMetrics = {
  titlePx: number;
  bodyPx: number;
  titleLineHeight: number;
  bodyLineHeight: number;
  gapAfterTitle: number;
};

function resolveLowerThirdMetrics(
  slideStyle?: SlideCanvasTextStyle
): LowerThirdMetrics {
  const f = FONT.lowerThird;
  const titlePx = slideStyle?.fontSizePrimaryPx ?? f.title;
  const bodyPx = slideStyle?.fontSizeSecondaryPx ?? f.body;
  return {
    titlePx,
    bodyPx,
    titleLineHeight: Math.round((titlePx * f.titleLineHeight) / f.title),
    bodyLineHeight: Math.round((bodyPx * f.bodyLineHeight) / f.body),
    gapAfterTitle:
      slideStyle?.gapAfterTitlePx ??
      Math.round((f.gapAfterTitle * bodyPx) / f.body),
  };
}

/** Use explicit `body` field, or text after a newline in `headline` (hook + supporting line). */
function splitHeadline(slide: { headline: string; body?: string }): {
  headline: string;
  body: string;
} {
  const explicit = slide.body?.trim() ?? "";
  if (explicit) {
    return { headline: slide.headline.trim(), body: explicit };
  }
  const h = slide.headline.trim();
  const nl = h.indexOf("\n");
  if (nl >= 0) {
    return {
      headline: h.slice(0, nl).trim(),
      body: h.slice(nl + 1).trim(),
    };
  }
  return { headline: h, body: "" };
}

/** Reserve space for slide counter + chevrons when clamping reference text vertically. */
const BOTTOM_COUNTER_RESERVE_PX = 88;

type OutlineOpts = { outlineColor: string; shadowMult: number };

/**
 * Stacked headline + body (same metrics as stacked-center), positioned from `placement`
 * (vision-matched reference image). Uses stacked metrics (optionally overridden px).
 */
function drawStackedCarouselTextBlock(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  title: string,
  body: string,
  width: number,
  height: number,
  textWrapWidth: number,
  placement: ReferenceTextPlacement,
  style: {
    metrics: StackedCarouselMetrics;
    textFillPrimary: string;
    textFillSecondary: string;
    famPrimary: string;
    famSecondary: string;
    lsPrimaryEm: number;
    lsSecondaryEm: number;
    outlineOpts: OutlineOpts;
    scaledOutline: (px: number) => number;
  }
): void {
  const {
    metrics: {
      titlePx,
      bodyPx,
      titleLineHeight,
      bodyLineHeight,
      gapBeforeBody,
    },
    textFillPrimary,
    textFillSecondary,
    famPrimary,
    famSecondary,
    lsPrimaryEm,
    lsSecondaryEm,
    outlineOpts,
    scaledOutline,
  } = style;

  const applyFont = (px: number, family: string, spacingEm: number): void => {
    ctx.font = `${px}px ${family}`;
    ctx.letterSpacing = `${spacingEm * px}px`;
  };

  ctx.textBaseline = "middle";

  if (!title.trim() && body) {
    applyFont(bodyPx, famSecondary, lsSecondaryEm);
    const onlyBody = wrapLinesOrNumericList(ctx, body, textWrapWidth, 4);
    const blockH = onlyBody.reduce(
      (s, d) => s + bodyLineHeight + (d.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
      0
    );
    const { anchorX, blockCenterY, textAlign } = resolveReferenceTextAnchor({
      width,
      height,
      contentInset: CONTENT_INSET,
      placement,
      blockHeight: blockH,
      bottomReservePx: BOTTOM_COUNTER_RESERVE_PX,
    });
    ctx.textAlign = textAlign;
    let y = blockCenterY - blockH / 2 + bodyLineHeight / 2;
    const bo = scaledOutline(bodyPx);
    for (const d of onlyBody) {
      drawOutlinedLine(ctx, d.text, anchorX, y, bo, textFillSecondary, outlineOpts);
      y += bodyLineHeight;
      if (d.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
    }
    return;
  }

  if (!title.trim() && !body) return;

  const titleTrim = title.trim();
  const titleIsList = titleTrim
    ? extractNumericListItems(titleTrim) !== null
    : false;
  if (titleTrim) {
    if (titleIsList) applyFont(bodyPx, famSecondary, lsSecondaryEm);
    else applyFont(titlePx, famPrimary, lsPrimaryEm);
  }
  const titleDrawLines = titleTrim
    ? wrapLinesOrNumericList(ctx, title, textWrapWidth, 4)
    : [];

  const useBodyForWrappedLine =
    !body && !titleIsList && titleDrawLines.length > 1;
  const fillForPrimaryBlockLine = (idx: number): string => {
    if (titleIsList) return textFillPrimary;
    if (useBodyForWrappedLine && idx > 0) return textFillSecondary;
    return textFillPrimary;
  };
  const titleSpecs = titleDrawLines.map((d, i) => {
    if (titleIsList) {
      return {
        line: d.text,
        px: bodyPx,
        family: famSecondary,
        lineHeight: bodyLineHeight,
        extraGapAfter: d.extraGapAfter,
      };
    }
    const sub = useBodyForWrappedLine && i > 0;
    return {
      line: d.text,
      px: sub ? bodyPx : titlePx,
      family: sub ? famSecondary : famPrimary,
      lineHeight: sub ? bodyLineHeight : titleLineHeight,
      extraGapAfter: d.extraGapAfter,
    };
  });

  let bodyDrawLines: DrawLine[] = [];
  if (body) {
    applyFont(bodyPx, famSecondary, lsSecondaryEm);
    bodyDrawLines = wrapLinesOrNumericList(ctx, body, textWrapWidth, 3);
  }

  const titleBlockH = titleSpecs.reduce(
    (s, p) =>
      s + p.lineHeight + (p.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
    0
  );
  const bodyBlockH = body
    ? gapBeforeBody +
      bodyDrawLines.reduce(
        (s, d) =>
          s + bodyLineHeight + (d.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
        0
      )
    : 0;
  const blockH = titleBlockH + bodyBlockH;
  const firstH = titleSpecs[0]?.lineHeight ?? bodyLineHeight;

  const { anchorX, blockCenterY, textAlign } = resolveReferenceTextAnchor({
    width,
    height,
    contentInset: CONTENT_INSET,
    placement,
    blockHeight: blockH,
    bottomReservePx: BOTTOM_COUNTER_RESERVE_PX,
  });
  ctx.textAlign = textAlign;

  let y = blockCenterY - blockH / 2 + firstH / 2;

  for (let ti = 0; ti < titleSpecs.length; ti++) {
    const spec = titleSpecs[ti]!;
    const spacingEm = spec.px === bodyPx ? lsSecondaryEm : lsPrimaryEm;
    applyFont(spec.px, spec.family, spacingEm);
    drawOutlinedLine(
      ctx,
      spec.line,
      anchorX,
      y,
      scaledOutline(spec.px),
      fillForPrimaryBlockLine(ti),
      outlineOpts
    );
    y += spec.lineHeight;
    if (spec.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
  }
  if (body) {
    y += gapBeforeBody;
    applyFont(bodyPx, famSecondary, lsSecondaryEm);
    const bodyOutline = scaledOutline(bodyPx);
    for (const d of bodyDrawLines) {
      drawOutlinedLine(
        ctx,
        d.text,
        anchorX,
        y,
        bodyOutline,
        textFillSecondary,
        outlineOpts
      );
      y += bodyLineHeight;
      if (d.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
    }
  }
}

export async function renderSlideToPng(
  framePath: string,
  slide: SlidePlan,
  slideIndex: number,
  slideCount: number,
  branding: BrandingPreset,
  layout: LayoutId,
  outPath: string,
  dimensions: RenderDimensions,
  slideStyle?: SlideCanvasTextStyle
): Promise<void> {
  const { width, height } = dimensions;
  const textFill = slideStyle?.textFill ?? TEXT_FILL;
  /** Carousel primary = headline / hook; secondary = body, wrapped sublines, counter. */
  const textFillPrimary = slideStyle?.textFillPrimary ?? textFill;
  const textFillSecondary = slideStyle?.textFillSecondary ?? textFill;
  const accentStroke = slideStyle?.accentStroke ?? TEXT_FILL;
  const textWrapWidth = width - 2 * CONTENT_INSET;
  const outlineColor = slideStyle?.outlineStroke ?? OUTLINE_COLOR;
  const outlineScale = slideStyle?.outlineWidthScale ?? 1;
  const shadowMult = dropShadowMult(slideStyle?.dropShadowStrength);
  const outlineOpts = { outlineColor, shadowMult };
  const lsPrimaryEm = slideStyle?.letterSpacingPrimaryEm ?? 0;
  const lsSecondaryEm =
    slideStyle?.letterSpacingSecondaryEm ?? slideStyle?.letterSpacingPrimaryEm ?? 0;
  const famPrimary = slideStyle?.fontFamilyPrimary ?? branding.fontFamilyTitle;
  const famSecondary = slideStyle?.fontFamilySecondary ?? branding.fontFamilyBody;

  const scaledOutline = (px: number) =>
    Math.max(2, Math.round(outlineWidthForFont(px) * outlineScale));

  const applyFont = (px: number, family: string, spacingEm: number): void => {
    ctx.font = `${px}px ${family}`;
    ctx.letterSpacing = `${spacingEm * px}px`;
  };

  ensureSlideFonts(famPrimary, famSecondary);
  const stackedMetrics = resolveStackedCarouselMetrics(slideStyle);
  const lowerThirdMetrics = resolveLowerThirdMetrics(slideStyle);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const img = await loadImage(await fs.readFile(framePath));
  ctx.drawImage(img, 0, 0, width, height);

  let { headline: title, body } = splitHeadline(slide);
  /** First exported slide only; slides 2+ use full headline/body from plan. */
  if (slideIndex === 0) {
    if (title.trim().length > 0) {
      if (title.length > FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS) {
        title = truncateHeadlineAtWordBoundary(
          title,
          FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS
        );
      }
    } else if (
      body.trim().length > 0 &&
      body.length > FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS
    ) {
      body = truncateHeadlineAtWordBoundary(
        body,
        FIRST_SLIDE_PRIMARY_HEADLINE_MAX_CHARS
      );
    }
  }

  ctx.textBaseline = "middle";
  const refPlacement = slideStyle?.referencePlacement ?? undefined;

  if (refPlacement) {
    drawStackedCarouselTextBlock(
      ctx,
      title,
      body,
      width,
      height,
      textWrapWidth,
      refPlacement,
      {
        metrics: stackedMetrics,
        textFillPrimary,
        textFillSecondary,
        famPrimary,
        famSecondary,
        lsPrimaryEm,
        lsSecondaryEm,
        outlineOpts,
        scaledOutline,
      }
    );
  } else {
    ctx.textAlign = "center";

  if (layout === "stacked_center") {
    const {
      titlePx,
      bodyPx,
      titleLineHeight,
      bodyLineHeight,
      gapBeforeBody,
    } = stackedMetrics;

    if (!title.trim() && body) {
      applyFont(bodyPx, famSecondary, lsSecondaryEm);
      const onlyBody = wrapLinesOrNumericList(ctx, body, textWrapWidth, 4);
      const blockH = onlyBody.reduce(
        (s, d) => s + bodyLineHeight + (d.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
        0
      );
      let y = height / 2 - blockH / 2 + bodyLineHeight / 2;
      const bo = scaledOutline(bodyPx);
      for (const d of onlyBody) {
        drawOutlinedLine(ctx, d.text, width / 2, y, bo, textFillSecondary, outlineOpts);
        y += bodyLineHeight;
        if (d.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
      }
    } else if (title.trim() || body) {
    const titleTrim = title.trim();
    const titleIsList = titleTrim
      ? extractNumericListItems(titleTrim) !== null
      : false;
    if (titleTrim) {
      if (titleIsList) applyFont(bodyPx, famSecondary, lsSecondaryEm);
      else applyFont(titlePx, famPrimary, lsPrimaryEm);
    }
    const titleDrawLines = titleTrim
      ? wrapLinesOrNumericList(ctx, title, textWrapWidth, 4)
      : [];

    const useBodyForWrappedLine =
      !body && !titleIsList && titleDrawLines.length > 1;
    /** Primary lines = headline; wrapped continuation lines without explicit body use secondary fill. */
    const fillForPrimaryBlockLine = (idx: number): string => {
      if (titleIsList) return textFillPrimary;
      if (useBodyForWrappedLine && idx > 0) return textFillSecondary;
      return textFillPrimary;
    };
    const titleSpecs = titleDrawLines.map((d, i) => {
      if (titleIsList) {
        return {
          line: d.text,
          px: bodyPx,
          family: famSecondary,
          lineHeight: bodyLineHeight,
          extraGapAfter: d.extraGapAfter,
        };
      }
      const sub = useBodyForWrappedLine && i > 0;
      return {
        line: d.text,
        px: sub ? bodyPx : titlePx,
        family: sub ? famSecondary : famPrimary,
        lineHeight: sub ? bodyLineHeight : titleLineHeight,
        extraGapAfter: d.extraGapAfter,
      };
    });

    let bodyDrawLines: DrawLine[] = [];
    if (body) {
      applyFont(bodyPx, famSecondary, lsSecondaryEm);
      bodyDrawLines = wrapLinesOrNumericList(ctx, body, textWrapWidth, 3);
    }

    const titleBlockH = titleSpecs.reduce(
      (s, p) =>
        s + p.lineHeight + (p.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
      0
    );
    const bodyBlockH = body
      ? gapBeforeBody +
        bodyDrawLines.reduce(
          (s, d) =>
            s + bodyLineHeight + (d.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
          0
        )
      : 0;
    const blockH = titleBlockH + bodyBlockH;
    const firstH = titleSpecs[0]?.lineHeight ?? bodyLineHeight;
    let y = height / 2 - blockH / 2 + firstH / 2;

    for (let ti = 0; ti < titleSpecs.length; ti++) {
      const spec = titleSpecs[ti]!;
      const spacingEm = spec.px === bodyPx ? lsSecondaryEm : lsPrimaryEm;
      applyFont(spec.px, spec.family, spacingEm);
      drawOutlinedLine(
        ctx,
        spec.line,
        width / 2,
        y,
        scaledOutline(spec.px),
        fillForPrimaryBlockLine(ti),
        outlineOpts
      );
      y += spec.lineHeight;
      if (spec.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
    }
    if (body) {
      y += gapBeforeBody;
      applyFont(bodyPx, famSecondary, lsSecondaryEm);
      const bodyOutline = scaledOutline(bodyPx);
      for (const d of bodyDrawLines) {
        drawOutlinedLine(
          ctx,
          d.text,
          width / 2,
          y,
          bodyOutline,
          textFillSecondary,
          outlineOpts
        );
        y += bodyLineHeight;
        if (d.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
      }
    }
    }
  } else {
    const {
      titlePx,
      bodyPx,
      titleLineHeight,
      bodyLineHeight,
      gapAfterTitle,
    } = lowerThirdMetrics;

    if (!title.trim() && body) {
      applyFont(bodyPx, famSecondary, lsSecondaryEm);
      const onlyBody = wrapLinesOrNumericList(ctx, body, textWrapWidth, 3);
      const blockH = onlyBody.reduce(
        (s, d) => s + bodyLineHeight + (d.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
        0
      );
      let y = height * 0.62 - blockH / 2 + bodyLineHeight / 2;
      const bo = scaledOutline(bodyPx);
      for (const d of onlyBody) {
        drawOutlinedLine(ctx, d.text, width / 2, y, bo, textFillSecondary, outlineOpts);
        y += bodyLineHeight;
        if (d.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
      }
    } else if (title.trim() || body) {
    const titleTrim = title.trim();
    const titleIsList = titleTrim
      ? extractNumericListItems(titleTrim) !== null
      : false;
    if (titleTrim) {
      if (titleIsList) applyFont(bodyPx, famSecondary, lsSecondaryEm);
      else applyFont(titlePx, famPrimary, lsPrimaryEm);
    }
    const titleDrawLines = titleTrim
      ? wrapLinesOrNumericList(ctx, title, textWrapWidth, 3)
      : [];

    const useBodyForWrappedLine =
      !body && !titleIsList && titleDrawLines.length > 1;
    const fillForPrimaryBlockLineLt = (idx: number): string => {
      if (titleIsList) return textFillPrimary;
      if (useBodyForWrappedLine && idx > 0) return textFillSecondary;
      return textFillPrimary;
    };
    const titleSpecs = titleDrawLines.map((d, i) => {
      if (titleIsList) {
        return {
          line: d.text,
          px: bodyPx,
          family: famSecondary,
          lineHeight: bodyLineHeight,
          extraGapAfter: d.extraGapAfter,
        };
      }
      const sub = useBodyForWrappedLine && i > 0;
      return {
        line: d.text,
        px: sub ? bodyPx : titlePx,
        family: sub ? famSecondary : famPrimary,
        lineHeight: sub ? bodyLineHeight : titleLineHeight,
        extraGapAfter: d.extraGapAfter,
      };
    });

    let bodyDrawLines: DrawLine[] = [];
    if (body) {
      applyFont(bodyPx, famSecondary, lsSecondaryEm);
      bodyDrawLines = wrapLinesOrNumericList(ctx, body, textWrapWidth, 2);
    }

    const titleBlockH = titleSpecs.reduce(
      (s, p) =>
        s + p.lineHeight + (p.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
      0
    );
    const bodyBlockH = body
      ? gapAfterTitle +
        bodyDrawLines.reduce(
          (s, d) =>
            s + bodyLineHeight + (d.extraGapAfter ? LIST_ITEM_GAP_EXTRA_PX : 0),
          0
        )
      : 0;
    const blockH = titleBlockH + bodyBlockH;
    const firstHL = titleSpecs[0]?.lineHeight ?? bodyLineHeight;
    let y = height * 0.62 - blockH / 2 + firstHL / 2;

    for (let ti = 0; ti < titleSpecs.length; ti++) {
      const spec = titleSpecs[ti]!;
      const spacingEm = spec.px === bodyPx ? lsSecondaryEm : lsPrimaryEm;
      applyFont(spec.px, spec.family, spacingEm);
      drawOutlinedLine(
        ctx,
        spec.line,
        width / 2,
        y,
        scaledOutline(spec.px),
        fillForPrimaryBlockLineLt(ti),
        outlineOpts
      );
      y += spec.lineHeight;
      if (spec.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
    }
    if (body) {
      y += gapAfterTitle;
      applyFont(bodyPx, famSecondary, lsSecondaryEm);
      const bodyOutline = scaledOutline(bodyPx);
      for (const d of bodyDrawLines) {
        drawOutlinedLine(
          ctx,
          d.text,
          width / 2,
          y,
          bodyOutline,
          textFillSecondary,
          outlineOpts
        );
        y += bodyLineHeight;
        if (d.extraGapAfter) y += LIST_ITEM_GAP_EXTRA_PX;
      }
    }
    }
  }
  }

  const counterPx = FONT.counter;
  applyFont(counterPx, famSecondary, 0);
  const counterOutline = scaledOutline(counterPx);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const marginRight = CONTENT_INSET;
  const bottomRowOffset = 18;
  const rowCenterY = height - CONTENT_INSET - bottomRowOffset;
  /** Match chevron scale to slide counter text (e.g. “4 / 5”). */
  const arrowSpan = Math.max(18, Math.round(counterPx * 0.92));
  const arrowArm = arrowSpan * 0.5;
  const gapTextToArrow = Math.max(8, Math.round(counterPx * 0.42));

  const isLastSlide = slideIndex >= slideCount - 1;
  const arrowTipX = width - marginRight;

  if (!isLastSlide) {
    drawDoubleChevronRight(
      ctx,
      arrowTipX,
      rowCenterY,
      arrowSpan,
      arrowArm,
      accentStroke,
      outlineColor
    );
  }

  const counterRightX = isLastSlide
    ? width - marginRight
    : arrowTipX - doubleChevronTotalWidth(arrowSpan) - gapTextToArrow;

  drawOutlinedLine(
    ctx,
    `${slideIndex + 1} / ${slideCount}`,
    counterRightX,
    rowCenterY,
    counterOutline,
    textFillSecondary,
    outlineOpts
  );

  const buf = await canvas.encode("png");
  await fs.writeFile(outPath, Buffer.from(buf));
}
