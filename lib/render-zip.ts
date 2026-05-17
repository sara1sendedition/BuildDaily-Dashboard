import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import JSZip from "jszip";
import {
  detectCarouselSlideCoverFocusNormalized,
  isCarouselFaceCropEnabled,
} from "@/lib/carousel-slide-face-focus";
import {
  probeDurationSec,
  extractFramePngProbeForFaceCrop,
  type CoverFocusNormalized,
} from "./ffmpeg";
import {
  extractVideoFrameWithAutoTone,
  normalizeImageCoverWithAutoTone,
} from "./frame-auto-tone";
import { normalizeSlidesForKeyframes } from "./slide-evidence";
import { effectiveDurationSec, slideTimestampSec } from "./slide-time";
import { renderSlideToPng } from "./render";
import type { RenderDimensions } from "./render";
import type { SlideCanvasTextStyle } from "./slide-canvas-types";
import { getBrandingById } from "./branding";
import type { FrameColorAdjust } from "./frame-color-adjust";
import type { BrandingPreset, LayoutId, SlidePlan, TranscriptSegment } from "./types";

/** Parallel slide jobs; each runs ffmpeg + canvas (bounded to avoid OOM). */
const SLIDE_RENDER_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const n = items.length;
  const out: R[] = new Array(n);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= n) return;
      out[i] = await mapper(items[i]!, i);
    }
  };
  const pool = Math.max(1, Math.min(limit, n));
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return out;
}

/** YouTube Shorts / community posts (1:1). */
export const FOLDER_YOUTUBE_1X1 = "youtube_1x1" as const;
/** Instagram feed portrait carousel (4:5, 1080×1350). */
export const FOLDER_INSTAGRAM_4X5 = "instagram_4x5" as const;

export const CAROUSEL_OUTPUT_FORMATS: ReadonlyArray<{
  folder: typeof FOLDER_YOUTUBE_1X1 | typeof FOLDER_INSTAGRAM_4X5;
  width: number;
  height: number;
}> = [
  { folder: FOLDER_YOUTUBE_1X1, width: 1080, height: 1080 },
  { folder: FOLDER_INSTAGRAM_4X5, width: 1080, height: 1350 },
];

export interface RenderZipInput {
  videoPath: string;
  slides: SlidePlan[];
  transcript: TranscriptSegment[];
  layoutId: LayoutId;
  brandingId?: string;
  /** Still image: normalized per output format (same cover math as video keyframes). */
  backgroundImagePath?: string;
  /** Optional text + inset frame colors from visual reference (carousel slot). */
  slideCanvasStyle?: SlideCanvasTextStyle;
  /** Optional FFmpeg eq+hue after cover/crop for video frames and background still. */
  frameColorAdjust?: FrameColorAdjust | null;
}

export interface RenderZipResult {
  zipBuffer: Buffer;
  /** First slide PNG for UI preview (1:1). */
  firstSlidePng: Buffer | null;
}

export async function renderSlidesToZip(
  input: RenderZipInput
): Promise<RenderZipResult> {
  const workDir = path.join(tmpdir(), `v2c-r-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const probed = await probeDurationSec(input.videoPath);
    const durationSec = effectiveDurationSec(probed, input.transcript);
    const branding: BrandingPreset = getBrandingById(input.brandingId);
    const framesDir = path.join(workDir, "frames");
    await fs.mkdir(framesDir, { recursive: true });

    const slides = normalizeSlidesForKeyframes(input.slides, input.transcript);
    let firstSlidePng: Buffer | null = null;

    const zip = new JSZip();

    let slideCoverFocusNorm: Array<CoverFocusNormalized | null> | null = null;
    const faceCrop =
      !input.backgroundImagePath && isCarouselFaceCropEnabled();
    if (faceCrop) {
      slideCoverFocusNorm = await mapWithConcurrency(
        slides,
        SLIDE_RENDER_CONCURRENCY,
        async (slide, i) => {
          const t = slideTimestampSec(
            slide,
            input.transcript,
            durationSec,
            i,
            slides.length
          );
          const probePath = path.join(workDir, `face-probe-${String(i)}.png`);
          try {
            await extractFramePngProbeForFaceCrop(
              input.videoPath,
              t,
              probePath
            );
            return await detectCarouselSlideCoverFocusNormalized(probePath);
          } catch {
            return null;
          } finally {
            await fs.rm(probePath, { force: true }).catch(() => undefined);
          }
        }
      );
    }

    const formatResults = await Promise.all(
      CAROUSEL_OUTPUT_FORMATS.map(async (fmt) => {
        const dims: RenderDimensions = {
          width: fmt.width,
          height: fmt.height,
        };

        let bgNormalizedPath: string | undefined;
        if (input.backgroundImagePath) {
          bgNormalizedPath = path.join(
            workDir,
            `bg-${fmt.folder}-${randomUUID()}.png`
          );
          await normalizeImageCoverWithAutoTone(
            input.backgroundImagePath,
            bgNormalizedPath,
            fmt.width,
            fmt.height,
            input.frameColorAdjust ?? null
          );
        }

        const slidePngs = await mapWithConcurrency(
          slides,
          SLIDE_RENDER_CONCURRENCY,
          async (slide, i) => {
            const t = slideTimestampSec(
              slide,
              input.transcript,
              durationSec,
              i,
              slides.length
            );
            const framePath = path.join(
              framesDir,
              `${fmt.folder}-frame-${i}.png`
            );
            const frameForText = bgNormalizedPath ?? framePath;
            if (!bgNormalizedPath) {
              const focusNorm =
                slideCoverFocusNorm?.[i] ?? null;
              await extractVideoFrameWithAutoTone(
                input.videoPath,
                t,
                framePath,
                {
                  width: fmt.width,
                  height: fmt.height,
                },
                input.frameColorAdjust ?? null,
                focusNorm
              );
            }
            const outPng = path.join(
              workDir,
              `${fmt.folder}-slide-${String(i + 1).padStart(2, "0")}.png`
            );
            await renderSlideToPng(
              frameForText,
              slide,
              i,
              slides.length,
              branding,
              input.layoutId,
              outPng,
              dims,
              input.slideCanvasStyle
            );
            return fs.readFile(outPng);
          }
        );

        return { fmt, slidePngs };
      })
    );

    for (const { fmt, slidePngs } of formatResults) {
      for (let i = 0; i < slidePngs.length; i++) {
        const b = slidePngs[i]!;
        zip.file(
          `${fmt.folder}/slide_${String(i + 1).padStart(2, "0")}.png`,
          b
        );
        if (i === 0 && fmt.folder === FOLDER_YOUTUBE_1X1) {
          firstSlidePng = b;
        }
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    return { zipBuffer, firstSlidePng };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
