import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { MAX_COPY_CONTEXT_CHARS } from "@/lib/copy-context";
import { coerceDefaultCaptionCtaField } from "@/lib/default-caption-cta";
import { MAX_CAROUSEL_FOCUS_CHARS } from "@/lib/carousel-focus";
import { parseVisualReferenceProfileJson } from "@/lib/visual-reference-for-prompt";
import { parseFrameColorAdjustJson } from "@/lib/frame-color-adjust";
import { runPipeline } from "@/lib/pipeline";
import { streamCarouselUploadToDisk } from "@/lib/stream-multipart-video";
import type { CarouselType, LayoutId, TranscriptSegment } from "@/lib/types";

/** JSON from client when skipping Whisper (Edit Carousel re-run). */
function parseExistingTranscriptJson(raw: string): TranscriptSegment[] | null {
  try {
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a) || a.length === 0) return null;
    const out: TranscriptSegment[] = [];
    for (let i = 0; i < a.length; i++) {
      const s = a[i];
      if (typeof s !== "object" || s === null) return null;
      const o = s as Record<string, unknown>;
      if (typeof o.text !== "string" || !String(o.text).trim()) return null;
      if (typeof o.startSec !== "number" || !Number.isFinite(o.startSec)) {
        return null;
      }
      if (typeof o.endSec !== "number" || !Number.isFinite(o.endSec)) return null;
      out.push({
        id: typeof o.id === "number" ? o.id : i,
        text: o.text,
        startSec: o.startSec,
        endSec: o.endSec,
      });
    }
    return out;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const maxDuration = 300;

const CAROUSEL_TYPES: CarouselType[] = [
  "example_breakdown",
  "listical",
  "step_by_step",
  "belief_shifting",
];

function parseCarouselType(v: string | null): CarouselType | "" {
  if (!v) return "";
  return CAROUSEL_TYPES.includes(v as CarouselType) ? (v as CarouselType) : "";
}

export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY ?? "";
  const useStub =
    process.env.USE_STUB_LLM === "true" || process.env.USE_STUB_LLM === "1";

  if (!key && !useStub) {
    return NextResponse.json(
      {
        error:
          "Missing OPENAI_API_KEY. Set it in .env.local or enable USE_STUB_LLM=true for UI testing.",
      },
      { status: 400 }
    );
  }

  let workDir: string;
  try {
    workDir = path.join(tmpdir(), `v2c-up-${randomUUID()}`);
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
  let uploadIngestMs = 0;

  try {
    const ingestT0 = performance.now();
    const result = await streamCarouselUploadToDisk(
      request,
      workDir,
      videoBasename
    );
    uploadIngestMs = Math.round(performance.now() - ingestT0);
    videoPath = result.videoPath;
    fields = result.fields;
    if (result.backgroundUploadPath) {
      backgroundImagePath = result.backgroundUploadPath;
    }
  } catch (e) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message =
      e instanceof Error ? e.message : "Invalid or incomplete upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const title = String(fields.title ?? "").trim() || undefined;
  const hint = String(fields.hint ?? "").trim() || undefined;
  const copyContextRaw = String(fields.copyContext ?? "").trim();
  const copyContext =
    copyContextRaw.length > 0
      ? copyContextRaw.slice(0, MAX_COPY_CONTEXT_CHARS)
      : undefined;
  const carouselFocusRaw = String(fields.carouselFocus ?? "").trim();
  const carouselFocus =
    carouselFocusRaw.length > 0
      ? carouselFocusRaw.slice(0, MAX_CAROUSEL_FOCUS_CHARS)
      : undefined;
  const defaultCaptionCta = coerceDefaultCaptionCtaField(
    fields.defaultCaptionCta
  );
  const layoutId = (String(fields.layoutId ?? "stacked_center") ||
    "stacked_center") as LayoutId;
  const brandingId = String(fields.brandingId ?? "default").trim();
  const carouselOverride = parseCarouselType(
    String(fields.carouselType ?? "")
  );

  const wantReuseTranscript =
    String(fields.reuseTranscription ?? "") === "1" ||
    String(fields.reuseTranscription ?? "").toLowerCase() === "true";

  let existingTranscript: TranscriptSegment[] | undefined;
  if (wantReuseTranscript) {
    const parsed = parseExistingTranscriptJson(String(fields.transcript ?? ""));
    if (!parsed) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      return NextResponse.json(
        {
          error:
            "reuseTranscription requires a valid non-empty transcript JSON array.",
        },
        { status: 400 }
      );
    }
    existingTranscript = parsed;
  }

  try {
    const pipelineT0 = performance.now();
    const visualReferenceCarousel = parseVisualReferenceProfileJson(
      fields.visualReferenceCarousel
    );
    const visualReferencePhoto = parseVisualReferenceProfileJson(
      fields.visualReferencePhoto
    );

    const frameColorAdjust = parseFrameColorAdjustJson(
      fields.frameColorAdjust
    );

    const pipelineResult = await runPipeline({
      videoPath,
      title,
      hint,
      carouselTypeOverride: carouselOverride,
      brandingId,
      layoutId:
        layoutId === "split_lower_third" ? "split_lower_third" : "stacked_center",
      openaiApiKey: key || "stub",
      useStubLlm: useStub,
      backgroundImagePath,
      existingTranscript,
      copyContext,
      carouselFocus,
      defaultCaptionCta,
      visualReferenceCarousel,
      visualReferencePhoto,
      frameColorAdjust: frameColorAdjust ?? null,
    });
    const serverPipelineMs = Math.round(performance.now() - pipelineT0);

    return NextResponse.json({
      recommendation: pipelineResult.recommendation,
      effectiveType: pipelineResult.effectiveType,
      transcript: pipelineResult.transcript,
      slides: pipelineResult.slides,
      socialCaption: pipelineResult.socialCaption,
      durationSec: pipelineResult.durationSec,
      zipBase64: pipelineResult.zipBuffer.toString("base64"),
      firstSlidePreviewBase64: pipelineResult.firstSlidePng
        ? pipelineResult.firstSlidePng.toString("base64")
        : null,
      uploadIngestMs,
      serverPipelineMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pipeline failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
