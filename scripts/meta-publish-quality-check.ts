/**
 * One-off / CI-friendly check: synthetic 1080×1350 "slide" PNG vs publish JPEG (0.89)
 * and high JPEG (0.98). Reports bytes and mean squared RGB error vs source canvas.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { pngBufferToJpegBuffer } from "../lib/meta/png-to-jpeg";

const W = 1080;
const H = 1350;
const PUBLISH_QUALITY = 0.89;

function drawStressSlide(): Buffer {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0f766e");
  g.addColorStop(1, "#134e4a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fef3c7";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("Carousel title line", 80, 200);
  ctx.font = "28px sans-serif";
  for (let i = 0; i < 12; i++) {
    ctx.fillText(
      `Body copy row ${i + 1} — sharp edges test 1234567890`,
      80,
      280 + i * 44
    );
  }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  for (let x = 0; x < W; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 900);
    ctx.lineTo(x + 3, 1280);
    ctx.stroke();
  }
  // Fine noise so JPEG quality settings actually change bitrate / error (flat fills do not).
  const id = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (i / 4) % 97;
    id.data[i] = Math.min(255, id.data[i]! + n);
    id.data[i + 1] = Math.max(0, id.data[i + 1]! - (n % 5));
  }
  ctx.putImageData(id, 0, 0);
  return canvas.toBuffer("image/png");
}

async function imageBufferToRgba(buf: Buffer): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const img = await loadImage(buf);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  return { data, width, height };
}

function mseRgba(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray
): { mse: number; maxChannelDiff: number } {
  let sum = 0;
  let n = 0;
  let maxD = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c]! - b[i + c]!;
      const ad = Math.abs(d);
      if (ad > maxD) maxD = ad;
      sum += d * d;
      n++;
    }
  }
  return { mse: sum / n, maxChannelDiff: maxD };
}

async function main() {
  const pngBuf = drawStressSlide();
  const ref = await imageBufferToRgba(pngBuf);
  const kb = (n: number) => Math.round(n / 102.4) / 10;

  const qualities = [0.5, PUBLISH_QUALITY, 0.98] as const;
  const perQuality: Record<
    string,
    { jpegBytes: number; jpegKb: number; rgbMseVsPng: number; maxRgbDiff: number }
  > = {};

  for (const q of qualities) {
    const jpeg = await pngBufferToJpegBuffer(pngBuf, q);
    const rgba = await imageBufferToRgba(jpeg);
    if (rgba.width !== ref.width || rgba.height !== ref.height) {
      throw new Error(`Dimension mismatch at q=${q}`);
    }
    const m = mseRgba(ref.data, rgba.data);
    perQuality[String(q)] = {
      jpegBytes: jpeg.length,
      jpegKb: kb(jpeg.length),
      rgbMseVsPng: Math.round(m.mse * 1000) / 1000,
      maxRgbDiff: m.maxChannelDiff,
    };
  }

  const pubBytes = perQuality[String(PUBLISH_QUALITY)]!.jpegBytes;

  console.log(JSON.stringify(
    {
      dimensions: `${ref.width}x${ref.height}`,
      pngBytes: pngBuf.length,
      pngKb: kb(pngBuf.length),
      publishPipelineUsesQuality: PUBLISH_QUALITY,
      jpegByQualityVsSourcePng: perQuality,
      compressionVsPngPublish: `${Math.round((100 * pubBytes) / pngBuf.length)}% of PNG size at publish quality`,
      interpretation:
        "Higher rgbMseVsPng / maxRgbDiff = more loss vs Download (PNG). " +
        "Publish uses quality " +
        String(PUBLISH_QUALITY) +
        " (0–1) in lib/meta/publish.ts, mapped to 0–100 for canvas JPEG encode. " +
        "Synthetic high-frequency noise inflates PNG vs JPEG oddly; real slides differ.",
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
