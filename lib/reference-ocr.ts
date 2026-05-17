/**
 * Browser-only OCR + layout heuristics using Tesseract.js (dynamic import).
 * Font *family* is not reliably identified from pixels; we surface Tesseract
 * engine fields when present and document limits in `layoutDocumentation`.
 */

import type {
  ReferenceOcrInference,
  ReferenceOcrLine,
} from "@/lib/visual-reference-types";

const TESS_VER = "5.1.1";

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function guessHookFormat(firstLine: string): ReferenceOcrInference["hookFormatGuess"] {
  const t = firstLine.trim();
  if (!t) return "unknown";
  const lower = t.toLowerCase();
  if (/\?\s*$/.test(t)) return "question";
  if (
    /^(why|how|what if|what's|what is|ever wondered|did you know)\b/i.test(lower)
  ) {
    return "curiosity_gap";
  }
  return "statement";
}

function scanCtaHints(fullText: string): ReferenceOcrInference["ctaHints"] {
  const t = fullText.toLowerCase();
  return {
    mentionsCaption: /\bcaption\b/.test(t),
    mentionsSwipe: /\bswipe\b/.test(t),
    mentionsLink: /\b(link in bio|linkinbio|link below|tap link)\b/.test(t),
    mentionsSave: /\bsave\b/.test(t) || /\bsave this\b/.test(t),
    mentionsFollow: /\bfollow\b/.test(t),
  };
}

function unionLineBounds(lines: ReferenceOcrLine[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const valid = lines.filter((l) => l.text.trim().length > 0);
  if (valid.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of valid) {
    const { x0, y0, x1, y1 } = l.bbox;
    minX = Math.min(minX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxX = Math.max(maxX, x0, x1);
    maxY = Math.max(maxY, y0, y1);
  }
  return { minX, minY, maxX, maxY };
}

type TesseractPage = {
  text: string;
  confidence: number;
  lines?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  words?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    font_name?: string;
    font_size?: number;
    is_bold?: boolean;
    is_serif?: boolean;
  }>;
  blocks?: unknown[] | null;
};

function linesFromPage(page: TesseractPage, w: number, h: number): ReferenceOcrLine[] {
  const raw = (page.lines ?? [])
    .map((l) => ({
      text: (l.text ?? "").replace(/\s+/g, " ").trim(),
      confidence: typeof l.confidence === "number" ? l.confidence : 0,
      bbox: l.bbox,
    }))
    .filter((l) => l.text.length > 0 && l.bbox);

  if (raw.length > 0) {
    return raw.map((l) => ({
      text: l.text,
      confidence: l.confidence,
      bbox: { ...l.bbox },
    }));
  }

  const fallback = (page.text ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lineH = Math.max(12, Math.round(h / Math.max(4, fallback.length + 1)));
  return fallback.map((text, i) => ({
    text,
    confidence: page.confidence ?? 0,
    bbox: {
      x0: Math.round(w * 0.08),
      y0: Math.round(h * 0.08 + i * lineH),
      x1: Math.round(w * 0.92),
      y1: Math.round(h * 0.08 + (i + 1) * lineH),
    },
  }));
}

function fontHintsFromWords(
  words: Array<{
    font_name?: string;
    font_size?: number;
    is_bold?: boolean;
    is_serif?: boolean;
  }>
): ReferenceOcrInference["fontFromEngine"] {
  const names = words
    .map((w) => (w.font_name ?? "").trim())
    .filter((n) => n.length > 0 && n.toLowerCase() !== "null");
  const unique = [...new Set(names)];
  const sizes = words
    .map((w) => w.font_size)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s > 0);
  const bolds = words.filter((w) => w.is_bold === true || w.is_bold === false);
  const boldTrue = bolds.filter((w) => w.is_bold === true).length;
  const boldFalse = bolds.filter((w) => w.is_bold === false).length;
  const serifs = words.filter((w) => w.is_serif === true || w.is_serif === false);
  const serifTrue = serifs.filter((w) => w.is_serif === true).length;
  const serifFalse = serifs.filter((w) => w.is_serif === false).length;

  let boldMajority: boolean | null = null;
  if (boldTrue + boldFalse > 0) {
    boldMajority = boldTrue >= boldFalse;
  }
  let serifMajority: boolean | null = null;
  if (serifTrue + serifFalse > 0) {
    serifMajority = serifTrue >= serifFalse;
  }

  return {
    engineFontNames: unique.slice(0, 12),
    medianFontSizePx: median(sizes),
    boldMajority,
    serifMajority,
    disclaimer:
      "Tesseract often omits font_name in LSTM-only builds. For reliable font family ID, use a dedicated font-identification API or manual notes.",
  };
}

const MAX_OCR_EDGE = 1600;

function imageToScaledCanvas(
  source: HTMLImageElement | HTMLCanvasElement
): { canvas: HTMLCanvasElement; scale: number } {
  const nw =
    "naturalWidth" in source ? source.naturalWidth : source.width;
  const nh =
    "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, MAX_OCR_EDGE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Canvas 2D unavailable");
  c.drawImage(source, 0, 0, w, h);
  return { canvas, scale };
}

export type ReferenceOcrProgress = (fraction: number, status: string) => void;

/**
 * Run OCR on an image or canvas (browser only). Loads Tesseract from CDN paths
 * compatible with the installed `tesseract.js` version.
 */
export async function runReferenceImageOcr(
  source: HTMLImageElement | HTMLCanvasElement,
  onProgress?: ReferenceOcrProgress
): Promise<ReferenceOcrInference> {
  if (typeof window === "undefined") {
    throw new Error("runReferenceImageOcr is browser-only");
  }

  const { canvas, scale } = imageToScaledCanvas(source);
  const w = canvas.width;
  const h = canvas.height;

  const { createWorker, OEM } = await import("tesseract.js");

  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESS_VER}/dist/worker.min.js`,
    corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESS_VER}/`,
    logger: (m: { status?: string; progress?: number }) => {
      if (m.progress != null && onProgress) {
        onProgress(m.progress, m.status ?? "");
      }
    },
  });

  try {
    const { data } = await worker.recognize(canvas);
    const page = data as TesseractPage;
    const lines = linesFromPage(page, w, h);
    const charLens = lines.map((l) => l.text.length).filter((n) => n > 0);
    const maxChars = charLens.length ? Math.max(...charLens) : 0;
    const medianChars = median(charLens) ?? 0;

    const u = unionLineBounds(lines);
    const marginsNorm = u
      ? {
          top: Math.max(0, u.minY / h),
          left: Math.max(0, u.minX / w),
          right: Math.max(0, (w - u.maxX) / w),
          bottom: Math.max(0, (h - u.maxY) / h),
        }
      : null;

    const firstLine = lines[0]?.text ?? page.text.split(/\r?\n/)[0] ?? "";
    const hookFormatGuess = guessHookFormat(firstLine);
    const ctaHints = scanCtaHints(page.text ?? "");

    const words = page.words ?? [];
    const fontFromEngine = fontHintsFromWords(words);

    const meanConfidence =
      lines.length > 0
        ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
        : page.confidence ?? 0;

    return {
      schemaVersion: 1,
      analyzedAtIso: new Date().toISOString(),
      imageWidth: Math.round(w / scale),
      imageHeight: Math.round(h / scale),
      rawText: (page.text ?? "").trim(),
      meanConfidence,
      lines,
      lineLengthStats: {
        maxChars,
        medianChars: Math.round(medianChars),
        lineCount: lines.length,
      },
      marginsNorm,
      hookFormatGuess,
      ctaHints,
      fontFromEngine,
      layoutDocumentation: {
        logoPlacement:
          "OCR does not detect logos reliably. Note corner marks, watermarks, or brand marks manually.",
        grid:
          "Grid / column structure is not inferred from OCR. Describe alignment in extended markdown.",
        strokeShadow:
          "Stroke, glow, and drop shadow are not measured here. Match by eye or document hex/width in notes.",
      },
    };
  } finally {
    await worker.terminate();
  }
}
