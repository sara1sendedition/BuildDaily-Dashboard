import * as blazeface from "@tensorflow-models/blazeface";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { CoverFocusNormalized } from "@/lib/ffmpeg";

/** Serialize inference; TFJS CPU + shared GraphModel are not reliably concurrent-safe. */
let inferenceTail = Promise.resolve();

function enqueueFaceInference<T>(fn: () => Promise<T>): Promise<T> {
  const started = inferenceTail.then(fn);
  inferenceTail = started.then(
    () => undefined,
    () => undefined
  );
  return started;
}

/** Lazy BlazeFace singleton (downloads weights on first use). */
let blazeFaceReadyPromise: Promise<blazeface.BlazeFaceModel> | null = null;

async function loadBlazeFaceOnce(): Promise<blazeface.BlazeFaceModel> {
  if (!blazeFaceReadyPromise) {
    blazeFaceReadyPromise = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
      return blazeface.load({
        maxFaces: 4,
        scoreThreshold: 0.5,
      });
    })();
  }
  return blazeFaceReadyPromise;
}

/** Carousel ZIP uses face bias only when unset or non-"0". */
export function isCarouselFaceCropEnabled(): boolean {
  return process.env.CAROUSEL_FACE_CROP !== "0";
}

/** Space above the face box top (forehead / hair) when planning crop. */
const HEADROOM_ABOVE_FACE_FRAC = 0.55;

/** When BlazeFace misses a face on portrait footage, bias crop upward (not center). */
const PORTRAIT_FALLBACK_FOCUS: CoverFocusNormalized = { x: 0.5, y: 0.34 };

function isPortraitFrame(w: number, h: number): boolean {
  return h > w * 1.05;
}

function faceDetectionProbability(face: blazeface.NormalizedFace): number {
  const p = face.probability;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  return 1;
}

/**
 * Normalized focus for FFmpeg cover-crop. Plans for the taller 4:5 window so 1:1 stays safe too.
 * Places the crop so the face box top sits below generous headroom.
 */
export function coverFocusFromFaceBoxPixels(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  imgW: number,
  imgH: number
): CoverFocusNormalized {
  const faceH = Math.max(1, maxY - minY);
  const headroomAbove = Math.max(16, faceH * HEADROOM_ABOVE_FACE_FRAC);
  const targetCropTop = Math.max(0, minY - headroomAbove);
  const refCropH = Math.min(imgH, Math.round(imgW * (5 / 4)));
  const py = (targetCropTop + refCropH / 2) / imgH;
  const cx = (minX + maxX) / 2;
  return {
    x: Math.min(1, Math.max(0, cx / imgW)),
    y: Math.min(0.88, Math.max(0.06, py)),
  };
}

function coverFocusFromLandmarks(
  landmarks: number[][],
  imgW: number,
  imgH: number
): CoverFocusNormalized | null {
  if (landmarks.length < 2) return null;
  const rightEye = landmarks[0];
  const leftEye = landmarks[1];
  if (!rightEye || !leftEye) return null;
  const eyeY = (rightEye[1]! + leftEye[1]!) / 2;
  const eyeX = (rightEye[0]! + leftEye[0]!) / 2;
  const eyeSpan = Math.abs(leftEye[0]! - rightEye[0]!);
  const headroom = Math.max(24, eyeSpan * 1.8);
  const targetCropTop = Math.max(0, eyeY - headroom);
  const refCropH = Math.min(imgH, Math.round(imgW * (5 / 4)));
  const py = (targetCropTop + refCropH / 2) / imgH;
  return {
    x: Math.min(1, Math.max(0, eyeX / imgW)),
    y: Math.min(0.88, Math.max(0.06, py)),
  };
}

/**
 * Normalized focus on probe PNG coords (= video aspect ratio). FFmpeg crop aligns this point when possible.
 * Returns null on landscape when detection fails (center crop). Portrait failures use top-biased fallback.
 */
export async function detectCarouselSlideCoverFocusNormalized(
  probePngPath: string
): Promise<CoverFocusNormalized | null> {
  let imageTensor: tf.Tensor3D | null = null;
  let portrait = false;
  try {
    const img = await loadImage(probePngPath);
    const w = img.width;
    const h = img.height;
    if (w < 8 || h < 8) return null;

    portrait = isPortraitFrame(w, h);

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const src = imageData.data;
    const data = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      const k = i * 3;
      data[k] = src[j]!;
      data[k + 1] = src[j + 1]!;
      data[k + 2] = src[j + 2]!;
    }

    imageTensor = tf.tensor3d(data, [h, w, 3]);
    const model = await loadBlazeFaceOnce();
    const faces = await enqueueFaceInference(() =>
      model.estimateFaces(imageTensor!, false, false, true)
    );
    if (!faces.length) {
      return portrait ? { ...PORTRAIT_FALLBACK_FOCUS } : null;
    }

    let bestScore = -1;
    let bestTL: [number, number] | null = null;
    let bestBR: [number, number] | null = null;
    let bestLandmarks: number[][] | null = null;

    for (const f of faces) {
      const prob = faceDetectionProbability(f);
      if (prob < 0.35) continue;

      const tl = f.topLeft as [number, number];
      const br = f.bottomRight as [number, number];
      const boxW = Math.abs(br[0] - tl[0]);
      const boxH = Math.abs(br[1] - tl[1]);
      const area = Math.max(0, boxW) * Math.max(0, boxH);
      const score = area * prob;
      if (score > bestScore) {
        bestScore = score;
        bestTL = tl;
        bestBR = br;
        bestLandmarks = Array.isArray(f.landmarks)
          ? (f.landmarks as number[][])
          : null;
      }
    }

    if (!bestTL || !bestBR || bestScore < 16) {
      return portrait ? { ...PORTRAIT_FALLBACK_FOCUS } : null;
    }

    const minX = Math.min(bestTL[0], bestBR[0]);
    const maxX = Math.max(bestTL[0], bestBR[0]);
    const minY = Math.min(bestTL[1], bestBR[1]);
    const maxY = Math.max(bestTL[1], bestBR[1]);

    const fromLandmarks = bestLandmarks
      ? coverFocusFromLandmarks(bestLandmarks, w, h)
      : null;
    const focus =
      fromLandmarks ??
      coverFocusFromFaceBoxPixels(minX, maxX, minY, maxY, w, h);

    if (!Number.isFinite(focus.x) || !Number.isFinite(focus.y)) {
      return portrait ? { ...PORTRAIT_FALLBACK_FOCUS } : null;
    }
    return focus;
  } catch {
    return portrait ? { ...PORTRAIT_FALLBACK_FOCUS } : null;
  } finally {
    if (imageTensor) imageTensor.dispose();
  }
}
