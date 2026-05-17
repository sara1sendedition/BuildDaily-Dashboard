/**
 * Video keyframes and background stills: scale/crop, optional brightness/hue/saturation.
 */

import type { FrameColorAdjust } from "@/lib/frame-color-adjust";
import {
  type CoverFocusNormalized,
  extractFramePng,
  normalizeImageToCover,
} from "@/lib/ffmpeg";

export async function extractVideoFrameWithAutoTone(
  videoPath: string,
  timeSec: number,
  outPngPath: string,
  dims: { width: number; height: number },
  colorAdjust?: FrameColorAdjust | null,
  coverFocusNorm?: CoverFocusNormalized | null
): Promise<void> {
  await extractFramePng(
    videoPath,
    timeSec,
    outPngPath,
    dims,
    colorAdjust ?? null,
    coverFocusNorm ?? null
  );
}

export async function normalizeImageCoverWithAutoTone(
  imagePath: string,
  outPngPath: string,
  width: number,
  height: number,
  colorAdjust?: FrameColorAdjust | null
): Promise<void> {
  await normalizeImageToCover(
    imagePath,
    outPngPath,
    width,
    height,
    colorAdjust ?? null
  );
}
