import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { INSTAGRAM_4_5, probeDurationSec } from "./ffmpeg";
import type { FrameColorAdjust } from "./frame-color-adjust";
import {
  extractVideoFrameWithAutoTone,
  normalizeImageCoverWithAutoTone,
} from "./frame-auto-tone";
import { getBrandingById } from "./branding";
import { generateImagePost, stubImagePostFromTranscript } from "./llm-image-post";
import { renderImagePostToBuffer } from "./render-image-post";
import { effectiveDurationSec, slideTimestampSec } from "./slide-time";
import {
  renumberSegmentIds,
  transcribeVideoFile,
} from "./transcribe-video-file";
import { formatVisualReferenceForLlm } from "@/lib/visual-reference-for-prompt";
import type { VisualReferenceProfile } from "@/lib/visual-reference-types";
import { deriveOverlayColorsFromProfile } from "@/lib/visual-reference-overlay";
import type { ImagePostPlan, PreviousImagePostPlan, TranscriptSegment } from "./types";
import { applyCaptionCtaAndCap } from "./default-caption-cta";

export interface ImagePostPipelineInput {
  videoPath: string;
  title?: string;
  hint?: string;
  openaiApiKey: string;
  useStubLlm: boolean;
  brandingId?: string;
  existingTranscript?: TranscriptSegment[];
  copyContext?: string;
  /** Optional excerpts / notes from trusted sources  -  enriches caption when transcript is thin. */
  referenceSources?: string;
  /** User refinement notes for the LLM (tone, length, fixes). */
  copyFeedback?: string;
  /** Prior generation when regenerating  -  pairs with copyFeedback for targeted edits. */
  previousPlan?: PreviousImagePostPlan;
  /** If set, use this still instead of a video frame (cropped to 4:5). */
  backgroundImagePath?: string;
  /** Image-post slot visual reference (LLM + overlay colors). */
  visualReferenceImage?: VisualReferenceProfile | null;
  frameColorAdjust?: FrameColorAdjust | null;
  /** Appended after caption body, before trailing hashtag lines (Settings). */
  defaultCaptionCta?: string;
}

export interface ImagePostPipelineResult {
  plan: ImagePostPlan;
  transcript: TranscriptSegment[];
  durationSec: number;
  frameTimeSec: number;
  pngBuffer: Buffer;
}

export async function runImagePostPipeline(
  input: ImagePostPipelineInput
): Promise<ImagePostPipelineResult> {
  const workDir = path.join(tmpdir(), `v2i-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const durationProbed = await probeDurationSec(input.videoPath);

    let transcript: TranscriptSegment[];
    const reuse =
      input.existingTranscript && input.existingTranscript.length > 0;

    if (reuse) {
      transcript = input.existingTranscript!.map((s) => ({ ...s }));
      renumberSegmentIds(transcript);
    } else {
      const { transcript: t } = await transcribeVideoFile(input.videoPath, {
        openaiApiKey: input.openaiApiKey,
        useStubLlm: input.useStubLlm,
        durationProbed,
      });
      transcript = t;
    }

    const durationSec = effectiveDurationSec(durationProbed, transcript);

    const imageRefPrompt = input.visualReferenceImage
      ? formatVisualReferenceForLlm(input.visualReferenceImage)
      : "";

    let plan: ImagePostPlan;
    if (input.useStubLlm) {
      plan = stubImagePostFromTranscript(transcript);
    } else {
      plan = await generateImagePost(
        transcript,
        input.title,
        input.hint,
        input.openaiApiKey,
        {
          copyContext: input.copyContext,
          referenceSources: input.referenceSources,
          copyFeedback: input.copyFeedback,
          previousPlan: input.previousPlan,
          visualReferencePrompt: imageRefPrompt || undefined,
        }
      );
    }

    plan = {
      ...plan,
      caption: applyCaptionCtaAndCap(plan.caption, input.defaultCaptionCta),
    };

    const overlayStyle = deriveOverlayColorsFromProfile(
      input.visualReferenceImage ?? undefined
    );

    const frameTimeSec = slideTimestampSec(
      { evidenceSegmentIds: plan.evidenceSegmentIds },
      transcript,
      durationSec,
      0,
      1
    );

    const branding = getBrandingById(input.brandingId);
    const framePath = path.join(workDir, "frame.png");

    if (input.backgroundImagePath) {
      await normalizeImageCoverWithAutoTone(
        input.backgroundImagePath,
        framePath,
        INSTAGRAM_4_5.width,
        INSTAGRAM_4_5.height,
        input.frameColorAdjust ?? null
      );
    } else {
      await extractVideoFrameWithAutoTone(
        input.videoPath,
        frameTimeSec,
        framePath,
        INSTAGRAM_4_5,
        input.frameColorAdjust ?? null
      );
    }

    const pngBuffer = await renderImagePostToBuffer(
      framePath,
      plan.hook,
      plan.microCta,
      branding,
      INSTAGRAM_4_5,
      overlayStyle,
      input.visualReferenceImage?.imageHookOverlay
    );

    return {
      plan,
      transcript,
      durationSec,
      frameTimeSec,
      pngBuffer,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Re-extract frame at `frameTimeSec` and render overlay (no LLM). Used when the user edits on-image copy. */
export async function renderImagePostFromVideoFrame(input: {
  videoPath: string;
  frameTimeSec: number;
  hook: string;
  microCta: string;
  brandingId?: string;
  visualReferenceImage?: VisualReferenceProfile | null;
  frameColorAdjust?: FrameColorAdjust | null;
}): Promise<Buffer> {
  const workDir = path.join(tmpdir(), `v2i-rerender-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const branding = getBrandingById(input.brandingId);
    const framePath = path.join(workDir, "frame.png");
    await extractVideoFrameWithAutoTone(
      input.videoPath,
      input.frameTimeSec,
      framePath,
      INSTAGRAM_4_5,
      input.frameColorAdjust ?? null
    );
    const overlayStyle = deriveOverlayColorsFromProfile(
      input.visualReferenceImage ?? undefined
    );
    return await renderImagePostToBuffer(
      framePath,
      input.hook,
      input.microCta,
      branding,
      INSTAGRAM_4_5,
      overlayStyle,
      input.visualReferenceImage?.imageHookOverlay
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
