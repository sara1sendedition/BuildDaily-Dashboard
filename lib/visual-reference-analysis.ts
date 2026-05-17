/**
 * Client-side reference image analysis (canvas ImageData).
 * Color/tone, palette, coarse composition; typography/deck items stay unknown unless edited.
 */

import type {
  ReferenceBackground,
  ReferenceColorTone,
  ReferenceComposition,
  ReferenceGradient,
  VisualReferenceKind,
  VisualReferenceProfile,
} from "@/lib/visual-reference-types";
import {
  emptyBranding,
  emptyCopyDeck,
  emptyTypography,
} from "@/lib/visual-reference-types";

const D65 = { Xn: 0.95047, Yn: 1.0, Zn: 1.08883 };

function srgbByteToLinear(u: number): number {
  const c = u / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbLinearToXyz(rl: number, gl: number, bl: number): [number, number, number] {
  const X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const Z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  return [X, Y, Z];
}

function fLab(t: number): number {
  const δ = 6 / 29;
  return t > δ ** 3 ? Math.cbrt(t) : t / (3 * δ * δ) + 4 / 29;
}

function xyzToLab(X: number, Y: number, Z: number): [number, number, number] {
  const xr = X / D65.Xn;
  const yr = Y / D65.Yn;
  const zr = Z / D65.Zn;
  const fx = fLab(xr);
  const fy = fLab(yr);
  const fz = fLab(zr);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return [L, a, b];
}

function linearRgbToLuma709(rl: number, gl: number, bl: number): number {
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - pos) + sorted[hi]! * (pos - lo);
}

/** McCamy correlated color temperature from xy (valid roughly 2000–10000K). */
function xyToKelvinMcCamy(x: number, y: number): number | null {
  const denom = 0.1858 - y;
  if (Math.abs(denom) < 1e-6) return null;
  const n = (x - 0.332) / denom;
  if (!Number.isFinite(n) || n < 0.2 || n > 0.9) return null;
  const T = -449 * n ** 3 + 3525 * n ** 2 - 6823.3 * n + 5520.33;
  if (!Number.isFinite(T) || T < 1500 || T > 15000) return null;
  return T;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, n | 0))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function kMeansRgb(
  samples: [number, number, number][],
  k: number,
  iterations: number
): { centroid: [number, number, number]; weight: number }[] {
  if (samples.length === 0) return [];
  const n = samples.length;
  const centroids: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(n / (k * 4)));
  for (let i = 0; i < k; i++) {
    const idx = Math.min(n - 1, i * step + Math.floor(Math.random() * step));
    centroids.push([...samples[idx]!]);
  }
  const assignments = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const p = samples[i]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const cc = centroids[c]!;
        const d =
          (p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2 + (p[2] - cc[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assignments[i] = best;
    }
    const sums: [number, number, number][] = Array.from({ length: k }, () => [
      0, 0, 0,
    ]);
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const c = assignments[i]!;
      const p = samples[i]!;
      sums[c]![0] += p[0];
      sums[c]![1] += p[1];
      sums[c]![2] += p[2];
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      centroids[c] = [
        sums[c]![0] / counts[c]!,
        sums[c]![1] / counts[c]!,
        sums[c]![2] / counts[c]!,
      ];
    }
  }
  const counts = new Int32Array(k);
  for (let i = 0; i < n; i++) counts[assignments[i]!]++;
  return centroids.map((centroid, i) => ({
    centroid,
    weight: counts[i]! / n,
  }));
}

function aspectLabel(r: number): string {
  const tol = 0.02;
  if (Math.abs(r - 1) < tol) return "1:1";
  if (Math.abs(r - 4 / 5) < tol || Math.abs(r - 5 / 4) < tol) return "4:5 / 5:4";
  if (Math.abs(r - 9 / 16) < tol || Math.abs(r - 16 / 9) < tol) return "9:16 / 16:9";
  if (Math.abs(r - 3 / 4) < tol || Math.abs(r - 4 / 3) < tol) return "3:4 / 4:3";
  return `${(r >= 1 ? r : 1 / r).toFixed(2)}:1`;
}

function buildColorTone(
  lumas: number[],
  meanLab: { L: number; a: number; b: number },
  meanChroma: number,
  midChroma: number,
  meanXyz: { x: number; y: number }
): ReferenceColorTone {
  lumas.sort((a, b) => a - b);
  const meanL = lumas.reduce((s, v) => s + v, 0) / lumas.length;
  const p5 = quantileSorted(lumas, 0.05);
  const p95 = quantileSorted(lumas, 0.95);
  const p1 = quantileSorted(lumas, 0.01);
  const p99 = quantileSorted(lumas, 0.99);
  const variance =
    lumas.reduce((s, v) => s + (v - meanL) ** 2, 0) / lumas.length;
  const hi = lumas.filter((v) => v >= 0.85);
  const lo = lumas.filter((v) => v <= 0.15);
  const chromaRel = meanChroma / 85;
  const sat01 = clamp01(chromaRel);
  const vibranceProxy =
    meanChroma > 0.01 ? clamp01(midChroma / meanChroma) : null;
  const T = xyToKelvinMcCamy(meanXyz.x, meanXyz.y);
  const chromaSmall = meanChroma < 12;
  return {
    exposureMeanLuma01: meanL,
    exposureOffsetEvEstimate: Number.isFinite(meanL)
      ? Math.log2((meanL + 0.02) / 0.45)
      : null,
    highlightsMeanLuma01: hi.length ? hi.reduce((s, v) => s + v, 0) / hi.length : null,
    shadowsMeanLuma01: lo.length ? lo.reduce((s, v) => s + v, 0) / lo.length : null,
    blackPointLuma01: p1,
    whitePointLuma01: p99,
    tonalSpread01: p95 - p5,
    lumaStd01: Math.sqrt(variance),
    colorTemperatureKelvin: T,
    colorTemperatureReliable: chromaSmall && T !== null,
    tintGreenMagentaAstar: meanLab.a,
    saturationIndex01: sat01,
    vibranceVsSaturationProxy: vibranceProxy,
  };
}

function detectGradient(rowMeans: number[], colMeans: number[]): ReferenceGradient {
  const regress = (values: number[]) => {
    const n = values.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += i;
      sy += values[i]!;
      sxx += i * i;
      sxy += i * values[i]!;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return { slope: 0, mean: sy / n };
    const slope = (n * sxy - sx * sy) / denom;
    return { slope, mean: sy / n };
  };
  const rv = regress(rowMeans);
  const cv = regress(colMeans);
  const vMag = Math.abs(rv.slope) * rowMeans.length;
  const hMag = Math.abs(cv.slope) * colMeans.length;
  const strength = clamp01(Math.max(vMag, hMag) * 4);
  let direction: ReferenceGradient["direction"] = "none";
  if (strength > 0.08) {
    if (vMag > hMag * 1.25) direction = "vertical";
    else if (hMag > vMag * 1.25) direction = "horizontal";
    else direction = "mixed";
  }
  return {
    detected: strength > 0.12,
    strength01: strength,
    direction,
  };
}

function buildComposition(
  w: number,
  h: number,
  gray: Float32Array,
  edgeMag: Float32Array
): ReferenceComposition {
  const ar = w / h;
  const label = aspectLabel(ar);
  let sumE = 0;
  let sumXE = 0;
  let sumYE = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const e = edgeMag[y * w + x]!;
      sumE += e;
      sumXE += x * e;
      sumYE += y * e;
    }
  }
  const focal =
    sumE > 1e-6
      ? { x: sumXE / sumE / w, y: sumYE / sumE / h }
      : { x: 0.5, y: 0.5 };
  const third = Math.floor(w / 3);
  let leftE = 0;
  let rightE = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < third; x++) leftE += edgeMag[y * w + x]!;
    for (let x = w - third; x < w - 1; x++) rightE += edgeMag[y * w + x]!;
  }
  const lr = leftE / (rightE + 1e-6);
  let balance: ReferenceComposition["balance"] = "unknown";
  if (lr > 1.35) balance = "weighted_left";
  else if (lr < 0.74) balance = "weighted_right";
  else balance = "symmetrical";
  const cx0 = Math.floor(w * 0.25);
  const cx1 = Math.floor(w * 0.75);
  const cy0 = Math.floor(h * 0.25);
  const cy1 = Math.floor(h * 0.75);
  let inner = 0;
  let outer = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = edgeMag[y * w + x]!;
      const inBand = x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;
      if (inBand) inner += e;
      else outer += e;
    }
  }
  const textGuess = clamp01((inner / (outer + 1e-6) - 0.4) * 2);
  return {
    aspectRatio: ar,
    aspectRatioLabel: label,
    textRegionLikelihood01: textGuess,
    focalPointNorm: focal,
    balance,
  };
}

function inferBackground(
  gradient: ReferenceGradient,
  meanSat: number
): ReferenceBackground {
  if (gradient.detected && (gradient.strength01 ?? 0) > 0.2) {
    return { type: "gradient", imageStyle: "unknown" };
  }
  if (meanSat > 0.22) {
    return { type: "photo", imageStyle: "photo" };
  }
  return { type: "solid", imageStyle: "unknown" };
}

/**
 * Analyze a downscaled RGBA ImageData (whole buffer used).
 */
export function analyzeImageData(
  data: ImageData,
  kind: VisualReferenceKind,
  fileName: string,
  opts?: { manualNotes?: string; manualExtendedMarkdown?: string }
): VisualReferenceProfile {
  const manualNotes = opts?.manualNotes ?? "";
  const manualExtendedMarkdown = opts?.manualExtendedMarkdown ?? "";
  const { width: w, height: h, data: buf } = data;
  const n = w * h;
  const lumas: number[] = [];
  const samples: [number, number, number][] = [];
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let nXyz = 0;
  let labCount = 0;
  let sumChroma = 0;
  let midChromaSum = 0;
  let midChromaN = 0;
  const step = Math.max(1, Math.floor(n / 50000));

  const rows = 16;
  const rowMeans = new Array(rows).fill(0);
  const rowCounts = new Array(rows).fill(0);
  const cols = 16;
  const colMeans = new Array(cols).fill(0);
  const colCounts = new Array(cols).fill(0);

  const gray = new Float32Array(w * h);
  const edgeMag = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = buf[i]!;
      const g = buf[i + 1]!;
      const b = buf[i + 2]!;
      const rl = srgbByteToLinear(r);
      const gl = srgbByteToLinear(g);
      const bl = srgbByteToLinear(b);
      const lum = clamp01(linearRgbToLuma709(rl, gl, bl));
      gray[y * w + x] = lum;
    }
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx =
        gray[idx + 1]! - gray[idx - 1]! + gray[idx + w + 1]! - gray[idx + w - 1]!;
      const gy =
        gray[idx + w]! - gray[idx - w]! + gray[idx + w + 1]! - gray[idx - w + 1]!;
      edgeMag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = buf[i]!;
      const g = buf[i + 1]!;
      const b = buf[i + 2]!;
      const rl = srgbByteToLinear(r);
      const gl = srgbByteToLinear(g);
      const bl = srgbByteToLinear(b);
      const lum = clamp01(linearRgbToLuma709(rl, gl, bl));
      lumas.push(lum);
      const [X, Y, Z] = rgbLinearToXyz(rl, gl, bl);
      sumX += X;
      sumY += Y;
      sumZ += Z;
      nXyz++;
      if (samples.length < 3500) {
        samples.push([r / 255, g / 255, b / 255]);
      }
      if (labCount < 12000 && lumas.length % 2 === 0) {
        const [L, a, bL] = xyzToLab(X, Y, Z);
        sumL += L;
        sumA += a;
        sumB += bL;
        const chroma = Math.hypot(a, bL);
        sumChroma += chroma;
        if (L >= 35 && L <= 65) {
          midChromaSum += chroma;
          midChromaN++;
        }
        labCount++;
      }
      const ri = Math.min(rows - 1, Math.floor((y / h) * rows));
      rowMeans[ri] += lum;
      rowCounts[ri]++;
      const ci = Math.min(cols - 1, Math.floor((x / w) * cols));
      colMeans[ci] += lum;
      colCounts[ci]++;
    }
  }

  for (let i = 0; i < rows; i++) {
    if (rowCounts[i]! > 0) rowMeans[i]! /= rowCounts[i]!;
  }
  for (let i = 0; i < cols; i++) {
    if (colCounts[i]! > 0) colMeans[i]! /= colCounts[i]!;
  }

  const mx = nXyz ? sumX / nXyz : 0;
  const my = nXyz ? sumY / nXyz : 0;
  const mz = nXyz ? sumZ / nXyz : 0;
  const s = mx + my + mz + 1e-9;
  const meanXyz = { x: mx / s, y: my / s };
  const meanLab = {
    L: labCount ? sumL / labCount : 50,
    a: labCount ? sumA / labCount : 0,
    b: labCount ? sumB / labCount : 0,
  };
  const meanChroma = labCount ? sumChroma / labCount : 0;
  const midChroma = midChromaN ? midChromaSum / midChromaN : meanChroma;
  const colorTone = buildColorTone(
    lumas,
    meanLab,
    meanChroma,
    midChroma,
    meanXyz
  );

  const kClust = Math.max(1, Math.min(4, samples.length));
  const km = kMeansRgb(samples, kClust, 8);
  const swatches = km
    .filter((k) => k.weight > 0.02)
    .sort((a, b) => b.weight - a.weight)
    .map((k) => ({
      hex: rgbToHex(
        Math.round(k.centroid[0] * 255),
        Math.round(k.centroid[1] * 255),
        Math.round(k.centroid[2] * 255)
      ),
      weight: k.weight,
    }));

  const gradient = detectGradient(rowMeans, colMeans);
  const composition = buildComposition(w, h, gray, edgeMag);
  const background = inferBackground(
    gradient,
    colorTone.saturationIndex01 ?? 0
  );

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    kind,
    fileName,
    analyzedAtIso: now,
    colorTone,
    palette: { swatches },
    gradient,
    composition,
    background,
    shapesIcons: {
      iconsUsed: null,
      iconStyleNote: null,
      shapesNote: null,
    },
    overlays: {
      blur: null,
      grain: null,
      glow: null,
      otherNote: null,
    },
    typography: emptyTypography(),
    copyDeck: emptyCopyDeck(),
    branding: emptyBranding(),
    technical: {
      widthPx: w,
      heightPx: h,
      megapixels: Math.round((w * h) / 100000) / 10,
      exportFormatNote: null,
      compressionArtifactScore01: null,
      safeAreaInsetFraction: 0.08,
    },
    manualNotes,
    manualExtendedMarkdown,
  };
}

const MAX_ANALYSIS_DIM = 640;

/**
 * Draw `img` into a working canvas (max edge {@link MAX_ANALYSIS_DIM}) and run {@link analyzeImageData}.
 */
export function analyzeHtmlImage(
  img: HTMLImageElement,
  kind: VisualReferenceKind,
  fileName: string,
  opts?: { manualNotes?: string; manualExtendedMarkdown?: string }
): VisualReferenceProfile {
  const scale = Math.min(
    1,
    MAX_ANALYSIS_DIM / Math.max(img.naturalWidth, img.naturalHeight)
  );
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const profile = analyzeImageData(imageData, kind, fileName, opts);
  const nw = Math.max(1, img.naturalWidth);
  const nh = Math.max(1, img.naturalHeight);
  profile.technical = {
    ...profile.technical,
    widthPx: nw,
    heightPx: nh,
    megapixels: Math.round((nw * nh) / 100000) / 10,
  };
  profile.composition.aspectRatio = nw / Math.max(1, nh);
  profile.composition.aspectRatioLabel = aspectLabel(nw / nh);
  return profile;
}

export function makeThumbnailDataUrl(
  img: HTMLImageElement,
  maxEdge = 360,
  quality = 0.75
): string | null {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}
