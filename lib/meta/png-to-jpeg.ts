import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * Lossy JPEG from PNG (canvas). Meta carousel publish uses this after validating PNG slides.
 * `quality` is 0–1 (node-canvas style); @napi-rs/canvas `encode('jpeg', q)` expects q in 0–100.
 */
export async function pngBufferToJpegBuffer(
  png: Buffer,
  quality = 0.98
): Promise<Buffer> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const q01 = Number.isFinite(quality) ? quality : 0.98;
  const q100 = Math.min(100, Math.max(1, Math.round(q01 * 100)));
  return await canvas.encode("jpeg", q100);
}
