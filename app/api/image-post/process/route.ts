import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { MAX_COPY_FEEDBACK_CHARS } from "@/lib/copy-feedback";
import { MAX_COPY_CONTEXT_CHARS } from "@/lib/copy-context";
import { MAX_REFERENCE_SOURCES_CHARS } from "@/lib/reference-sources";
import { coerceDefaultCaptionCtaField } from "@/lib/default-caption-cta";
import { parseVisualReferenceProfileJson } from "@/lib/visual-reference-for-prompt";
import { parseFrameColorAdjustJson } from "@/lib/frame-color-adjust";
import { runImagePostPipeline } from "@/lib/pipeline-image-post";
import { streamVideoFieldToDisk } from "@/lib/stream-multipart-video";
import type { PreviousImagePostPlan, TranscriptSegment } from "@/lib/types";

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

function parsePreviousPlanJson(raw: string): PreviousImagePostPlan | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== "object" || o === null) return null;
    const x = o as Record<string, unknown>;
    if (typeof x.hook !== "string") return null;
    if (typeof x.microCta !== "string") return null;
    if (typeof x.caption !== "string") return null;
    const altText = typeof x.altText === "string" ? x.altText : "";
    return { hook: x.hook, microCta: x.microCta, caption: x.caption, altText };
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const workDir = path.join(tmpdir(), `v2i-up-${randomUUID()}`);
  try {
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

  try {
    const result = await streamVideoFieldToDisk(
      request,
      workDir,
      videoBasename
    );
    videoPath = result.videoPath;
    fields = result.fields;
  } catch (e) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message =
      e instanceof Error ? e.message : "Invalid or incomplete upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {

    const copyContextRaw = String(fields.copyContext ?? "").trim();
    const copyContext =
      copyContextRaw.length > 0
        ? copyContextRaw.slice(0, MAX_COPY_CONTEXT_CHARS)
        : undefined;

    const referenceSourcesRaw = String(fields.referenceSources ?? "").trim();
    const referenceSources =
      referenceSourcesRaw.length > 0
        ? referenceSourcesRaw.slice(0, MAX_REFERENCE_SOURCES_CHARS)
        : undefined;

    const copyFeedbackRaw = String(fields.copyFeedback ?? "").trim();
    const copyFeedback =
      copyFeedbackRaw.length > 0
        ? copyFeedbackRaw.slice(0, MAX_COPY_FEEDBACK_CHARS)
        : undefined;

    const previousPlanRaw = String(fields.previousPlan ?? "").trim();
    let previousPlan: PreviousImagePostPlan | undefined;
    if (previousPlanRaw) {
      const parsed = parsePreviousPlanJson(previousPlanRaw);
      if (!parsed) {
        return NextResponse.json(
          {
            error:
              "previousPlan must be JSON with string fields hook, microCta, caption, and optional altText.",
          },
          { status: 400 }
        );
      }
      previousPlan = parsed;
    }

    const wantReuseTranscript =
      String(fields.reuseTranscription ?? "") === "1" ||
      String(fields.reuseTranscription ?? "").toLowerCase() === "true";

    let existingTranscript: TranscriptSegment[] | undefined;
    if (wantReuseTranscript) {
      const parsed = parseExistingTranscriptJson(String(fields.transcript ?? ""));
      if (!parsed) {
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

    const visualReferenceImage = parseVisualReferenceProfileJson(
      fields.visualReferenceImage
    );

    const frameColorAdjust = parseFrameColorAdjustJson(
      fields.frameColorAdjust
    );

    const defaultCaptionCta = coerceDefaultCaptionCtaField(
      fields.defaultCaptionCta
    );

    const pipelineResult = await runImagePostPipeline({
      videoPath,
      openaiApiKey: key || "stub",
      useStubLlm: useStub,
      existingTranscript,
      copyContext,
      referenceSources,
      copyFeedback,
      previousPlan,
      visualReferenceImage,
      frameColorAdjust: frameColorAdjust ?? null,
      defaultCaptionCta,
    });

    return NextResponse.json({
      hook: pipelineResult.plan.hook,
      microCta: pipelineResult.plan.microCta,
      caption: pipelineResult.plan.caption,
      altText: pipelineResult.plan.altText,
      evidenceSegmentIds: pipelineResult.plan.evidenceSegmentIds,
      transcript: pipelineResult.transcript,
      durationSec: pipelineResult.durationSec,
      frameTimeSec: pipelineResult.frameTimeSec,
      imageBase64: pipelineResult.pngBuffer.toString("base64"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

