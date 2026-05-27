import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { parseVisualReferenceProfileJson } from "@/lib/visual-reference-for-prompt";
import { deriveOverlayColorsFromProfile } from "@/lib/visual-reference-overlay";
import { mergedStudioSlideStyleWithProfileAccent } from "@/lib/studio-carousel-text-style";
import { parseFrameColorAdjustJson } from "@/lib/frame-color-adjust";
import { isAllowedSourceVideoUrl } from "@/lib/allowed-source-video-url";
import { fetchUrlToFile } from "@/lib/fetch-url-to-file";
import { renderSlidesToZip } from "@/lib/render-zip";
import { streamCarouselUploadToDisk } from "@/lib/stream-multipart-video";
import type { LayoutId, SlidePlan, TranscriptSegment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let workDir: string;
  try {
    workDir = path.join(tmpdir(), `v2c-re-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not create a temp folder for the upload.",
      },
      { status: 500 }
    );
  }
  const videoBasename = `input-${randomUUID()}.mp4`;

  let videoPath: string;
  let fields: Record<string, string>;
  let backgroundImagePath: string | undefined;

  try {
    const result = await streamCarouselUploadToDisk(
      request,
      workDir,
      videoBasename
    );
    videoPath = result.videoPath;
    fields = result.fields;
    if (result.backgroundUploadPath) {
      backgroundImagePath = result.backgroundUploadPath;
    }
    const resolveSourceVideoUrl = (): string => {
      const sourceUrl = String(fields.sourceVideoUrl ?? "").trim();
      if (!sourceUrl) {
        throw new Error("Missing source video URL");
      }
      if (!isAllowedSourceVideoUrl(sourceUrl)) {
        throw new Error("Source video URL is not from an allowed storage host");
      }
      return sourceUrl;
    };

    if (!result.videoUploaded) {
      await fetchUrlToFile(resolveSourceVideoUrl(), videoPath, {
        timeoutMs: 240_000,
      });
    } else {
      const stat = await fs.stat(videoPath);
      if (stat.size === 0) {
        await fetchUrlToFile(resolveSourceVideoUrl(), videoPath, {
          timeoutMs: 240_000,
        });
      }
    }
  } catch (e) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message =
      e instanceof Error ? e.message : "Invalid or incomplete upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const slidesRaw = String(fields.slides ?? "");
  const transcriptRaw = String(fields.transcript ?? "");
  const layoutId = (String(fields.layoutId ?? "stacked_center") ||
    "stacked_center") as LayoutId;
  const brandingId = String(fields.brandingId ?? "default").trim();
  let slides: SlidePlan[];
  let transcript: TranscriptSegment[];
  try {
    slides = JSON.parse(slidesRaw) as SlidePlan[];
    transcript = JSON.parse(transcriptRaw) as TranscriptSegment[];
  } catch {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    return NextResponse.json(
      { error: "Invalid slides or transcript JSON" },
      { status: 400 }
    );
  }

  if (!Array.isArray(slides) || slides.length === 0) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    return NextResponse.json(
      { error: "slides must be a non-empty array" },
      { status: 400 }
    );
  }

  const vrCarousel = parseVisualReferenceProfileJson(
    fields.visualReferenceCarousel
  );
  const slideCanvasStyle = mergedStudioSlideStyleWithProfileAccent(
    deriveOverlayColorsFromProfile(vrCarousel ?? undefined)
  );

  const frameColorAdjust = parseFrameColorAdjustJson(fields.frameColorAdjust);

  try {
    const rendered = await renderSlidesToZip({
      videoPath,
      slides,
      transcript,
      layoutId:
        layoutId === "split_lower_third" ? "split_lower_third" : "stacked_center",
      brandingId,
      backgroundImagePath,
      slideCanvasStyle,
      frameColorAdjust: frameColorAdjust ?? null,
    });

    return NextResponse.json({
      zipBase64: rendered.zipBuffer.toString("base64"),
      firstSlidePreviewBase64: rendered.firstSlidePng
        ? rendered.firstSlidePng.toString("base64")
        : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Render failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
