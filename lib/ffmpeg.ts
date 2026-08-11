import { execFile } from "child_process";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import {
  type FrameColorAdjust,
  frameColorAdjustFilterChain,
  isNeutralFrameColorAdjust,
} from "./frame-color-adjust";

const execFileAsync = promisify(execFile);

/** Scale to cover then center-crop (no color filters). */
export function coverCropVf(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

/** Normalized point on the source frame used after FFmpeg scale-to-cover (crop aligns so this stays centered when possible). */
export type CoverFocusNormalized = { x: number; y: number };

function clampCoverFocusNorm(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/**
 * Scale-to-cover then crop so `(focus.x, focus.y)` (normalized 0–1 on the scaled frame)
 * is centered within the output window (clamped to valid crop bounds).
 * Falls back to center crop when `focus` is null.
 */
export function coverCropFocusColorVf(
  width: number,
  height: number,
  focus: CoverFocusNormalized | null | undefined,
  color?: FrameColorAdjust | null
): string {
  const W = width;
  const H = height;
  let geo: string;
  if (
    focus != null &&
    Number.isFinite(focus.x) &&
    Number.isFinite(focus.y)
  ) {
    const px = clampCoverFocusNorm(focus.x).toFixed(6);
    const py = clampCoverFocusNorm(focus.y).toFixed(6);
    geo = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:max(0\\,min(iw-${W}\\,iw*${px}-(${W}/2))):max(0\\,min(ih-${H}\\,ih*${py}-(${H}/2)))`;
  } else {
    geo = coverCropVf(W, H);
  }
  if (!color || isNeutralFrameColorAdjust(color)) return geo;
  return `${geo},${frameColorAdjustFilterChain(color)}`;
}

/** Cover/crop then optional eq+hue (same order for video frames and stills). */
export function coverCropColorVf(
  width: number,
  height: number,
  color?: FrameColorAdjust | null
): string {
  const geo = coverCropVf(width, height);
  if (!color || isNeutralFrameColorAdjust(color)) return geo;
  return `${geo},${frameColorAdjustFilterChain(color)}`;
}

/** Prefer Homebrew paths when `ffmpeg` is not on the process PATH (common in GUI-launched apps on macOS). */
function resolveBinary(name: "ffmpeg" | "ffprobe"): string {
  if (process.platform === "darwin") {
    const candidates = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  return name;
}

const FFMPEG_INSTALL_HINT =
  "FFmpeg is not installed or not on your PATH. " +
  "Install it and restart the terminal (and the dev server). " +
  "macOS: brew install ffmpeg. " +
  "Windows: https://ffmpeg.org/download.html or winget install ffmpeg. " +
  "Linux: sudo apt install ffmpeg (Debian/Ubuntu).";

function enrichSpawnError(err: unknown, binary: string): Error {
  const e = err as NodeJS.ErrnoException & { code?: string };
  if (e?.code === "ENOENT") {
    return new Error(`${binary}: ${FFMPEG_INSTALL_HINT}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

async function execBinary(
  binary: "ffmpeg" | "ffprobe",
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const resolved = resolveBinary(binary);
  try {
    return await execFileAsync(resolved, args);
  } catch (err) {
    throw enrichSpawnError(err, binary);
  }
}

export type LumaSampleStats = {
  mean: number;
  p5: number;
  p95: number;
};

/** Luma stats from a small downscaled RGB sample (FFmpeg → raw rgb24). */
export async function sampleLumaStatsFromPng(
  pngPath: string,
  sampleSide = 96
): Promise<LumaSampleStats> {
  const fallback: LumaSampleStats = { mean: 0.45, p5: 0.08, p95: 0.92 };
  const resolved = resolveBinary("ffmpeg");
  let buf: Buffer;
  try {
    const { stdout } = await execFileAsync(resolved, [
      "-y",
      "-i",
      pngPath,
      "-vf",
      `scale=${sampleSide}:${sampleSide}:flags=area,format=rgb24`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ], {
      maxBuffer: sampleSide * sampleSide * 3 + 65536,
      encoding: "buffer",
    });
    buf = stdout as Buffer;
  } catch {
    return fallback;
  }
  const expected = sampleSide * sampleSide * 3;
  if (buf.length < expected) return fallback;
  const lumas: number[] = [];
  for (let i = 0; i < expected; i += 3) {
    const r = buf[i]! / 255;
    const g = buf[i + 1]! / 255;
    const b = buf[i + 2]! / 255;
    lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
  }
  lumas.sort((a, b) => a - b);
  const n = lumas.length;
  if (n === 0) return fallback;
  const mean = lumas.reduce((s, v) => s + v, 0) / n;
  const p5 = lumas[Math.min(n - 1, Math.floor(0.05 * (n - 1)))];
  const p95 = lumas[Math.min(n - 1, Math.ceil(0.95 * (n - 1)))];
  return { mean, p5, p95 };
}

/** Mean perceptual luma in 0…1 (convenience for auto-tone merge). */
export async function sampleMeanLumaFromPng(
  pngPath: string,
  sampleSide = 96
): Promise<number> {
  const s = await sampleLumaStatsFromPng(pngPath, sampleSide);
  return s.mean;
}

export async function extractAudioMp3(
  videoPath: string,
  outDir: string
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `audio-${Date.now()}.mp3`);
  await execBinary("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-ar",
    "16000",
    "-ac",
    "1",
    outPath,
  ]);
  return outPath;
}

/**
 * Remux an MP4 so the moov atom is at the front (`+faststart`). Required for
 * reliable iOS Safari progressive playback of CDN-hosted Shorts.
 *
 * Video is stream-copied; audio is re-encoded to AAC when present so iPhone
 * Safari does not reject uncommon audio codecs inside an otherwise-valid MP4.
 */
export async function remuxMp4Faststart(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const resolved = resolveBinary("ffmpeg");
  const common = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
  ] as const;

  const attempts: string[][] = [
    // Prefer: copy video, AAC audio (iOS-safe), faststart.
    [
      ...common,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ],
    // Fallback: pure stream copy (no audio re-encode).
    [
      ...common,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ],
  ];

  let lastErr: unknown;
  for (const args of attempts) {
    try {
      await execFileAsync(resolved, args, { maxBuffer: 8 * 1024 * 1024 });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw enrichSpawnError(lastErr, "ffmpeg");
}

/**
 * Transcode a reel into a maximally iPhone-Safari-safe MP4 for in-app preview.
 * Baseline H.264 + AAC-LC + yuv420p + faststart. Caps long edge at 1280 so
 * first-open remux stays reasonable on small Hub boxes.
 */
export async function transcodeMp4ForIosPreview(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const resolved = resolveBinary("ffmpeg");
  try {
    await execFileAsync(
      resolved,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale='min(720,iw)':-2:flags=bicubic,format=yuv420p",
        "-c:v",
        "libx264",
        "-profile:v",
        "baseline",
        "-level",
        "3.1",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        outputPath,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    // Fall back to stream-copy remux if encode isn't available (rare).
    try {
      await remuxMp4Faststart(inputPath, outputPath);
      return;
    } catch {
      throw enrichSpawnError(err, "ffmpeg");
    }
  }
}

/** Remux a buffer in a temp dir; returns the faststart buffer (or original on failure). */
export async function ensureMp4FaststartBuffer(
  buffer: Buffer,
): Promise<Buffer> {
  const workDir = path.join(
    tmpdir(),
    `mp4-faststart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const inPath = path.join(workDir, "in.mp4");
  const outPath = path.join(workDir, "out.mp4");
  try {
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(inPath, buffer);
    await remuxMp4Faststart(inPath, outPath);
    const out = await fs.readFile(outPath);
    if (out.length > 0) return out;
  } catch {
    // Fall through — better to upload the original than fail the job.
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return buffer;
}

export type FrameDimensions = { width: number; height: number };

const DEFAULT_FRAME: FrameDimensions = { width: 1080, height: 1080 };

/** Instagram feed portrait 4:5 (image post pipeline). */
export const INSTAGRAM_4_5: FrameDimensions = { width: 1080, height: 1350 };

/**
 * Seconds of video to decode after an input seek (second `-ss`) for accurate
 * framing. Coarse seek uses `max(0, t - margin)` before `-i` so long files do
 * not decode from t=0 on every slide.
 */
const FRAME_EXTRACT_INPUT_SEEK_MARGIN_SEC = 4;

/** Downscaled probe frame for BlazeFace (same aspect ratio as video). */
const FACE_PROBE_MAX_EDGE_PX = 960;

export async function extractFramePngProbeForFaceCrop(
  videoPath: string,
  timeSec: number,
  outPath: string
): Promise<void> {
  const t = Math.max(0, timeSec);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const margin = FRAME_EXTRACT_INPUT_SEEK_MARGIN_SEC;
  const coarseSec = Math.max(0, t - margin);
  const fineSec = t - coarseSec;
  await execBinary("ffmpeg", [
    "-y",
    "-ss",
    String(coarseSec),
    "-i",
    videoPath,
    "-ss",
    String(fineSec),
    "-vframes",
    "1",
    "-vf",
    `scale=min(${FACE_PROBE_MAX_EDGE_PX}\\,iw):-2`,
    outPath,
  ]);
}

export async function extractFramePng(
  videoPath: string,
  timeSec: number,
  outPath: string,
  dimensions: FrameDimensions = DEFAULT_FRAME,
  colorAdjust?: FrameColorAdjust | null,
  coverFocusNorm?: CoverFocusNormalized | null
): Promise<void> {
  const t = Math.max(0, timeSec);
  const { width: W, height: H } = dimensions;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const margin = FRAME_EXTRACT_INPUT_SEEK_MARGIN_SEC;
  const coarseSec = Math.max(0, t - margin);
  const fineSec = t - coarseSec;
  // `-ss` before `-i` jumps near the target without decoding from 0; `-ss` after
  // `-i` refines to the exact timestamp (same accuracy as seek-only-after-input).
  await execBinary("ffmpeg", [
    "-y",
    "-ss",
    String(coarseSec),
    "-i",
    videoPath,
    "-ss",
    String(fineSec),
    "-vframes",
    "1",
    "-vf",
    coverCropFocusColorVf(W, H, coverFocusNorm ?? null, colorAdjust ?? null),
    outPath,
  ]);
}

/**
 * Scale/crop a still image to exact pixels (same cover math as video keyframes).
 */
export async function normalizeImageToCover(
  imagePath: string,
  outPngPath: string,
  width: number,
  height: number,
  colorAdjust?: FrameColorAdjust | null
): Promise<void> {
  await fs.mkdir(path.dirname(outPngPath), { recursive: true });
  await execBinary("ffmpeg", [
    "-y",
    "-i",
    imagePath,
    "-vf",
    coverCropColorVf(width, height, colorAdjust ?? null),
    "-frames:v",
    "1",
    outPngPath,
  ]);
}

/**
 * Scale/crop a still image to 1080×1080 (same cover math as video keyframes).
 */
export async function normalizeImageToSquare1080(
  imagePath: string,
  outPngPath: string
): Promise<void> {
  await normalizeImageToCover(imagePath, outPngPath, 1080, 1080);
}

export async function probeDurationSec(videoPath: string): Promise<number> {
  const ffprobe = resolveBinary("ffprobe");
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const n = parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      throw enrichSpawnError(err, "ffprobe");
    }
    return 0;
  }
}
