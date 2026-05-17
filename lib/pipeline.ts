import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { probeDurationSec } from "./ffmpeg";
import {
  renumberSegmentIds,
  transcribeVideoFile,
} from "./transcribe-video-file";
import {
  generateCarouselSocialCaption,
  generateSlides,
  recommendCarouselType,
  STUB_CAROUSEL_SOCIAL_CAPTION,
  stubSlidesFromTranscript,
} from "./llm";
import { validateSlides } from "./validate-slides";
import { renderSlidesToZip } from "./render-zip";
import { normalizeSlidesForKeyframes } from "./slide-evidence";
import { effectiveDurationSec } from "./slide-time";
import type { FrameColorAdjust } from "@/lib/frame-color-adjust";
import type { VisualReferenceProfile } from "@/lib/visual-reference-types";
import {
  formatVisualReferenceForLlm,
  joinVisualReferencePrompts,
} from "@/lib/visual-reference-for-prompt";
import { deriveOverlayColorsFromProfile } from "@/lib/visual-reference-overlay";
import type { SlideCanvasTextStyle } from "@/lib/slide-canvas-types";
import { mergedStudioSlideStyleWithProfileAccent } from "@/lib/studio-carousel-text-style";
import { extractCarouselTextStyleFromImagePath } from "@/lib/extract-carousel-style-vision";
import {
  slideCanvasStyleFromVision,
  visionStyleLlmAppendix,
} from "@/lib/slide-style-from-vision";
import type { CarouselRecommendation, CarouselType, LayoutId, SlidePlan, TranscriptSegment } from "./types";
import { applyCaptionCtaAndCap } from "./default-caption-cta";

export interface PipelineInput {
  videoPath: string;
  title?: string;
  hint?: string;
  carouselTypeOverride?: CarouselType | "";
  brandingId?: string;
  layoutId: LayoutId;
  openaiApiKey: string;
  useStubLlm: boolean;
  /** If set, still image used behind text (cropped per export format) instead of video frames. */
  backgroundImagePath?: string;
  /**
   * When non-empty, skip audio extraction + Whisper and use these segments
   * (e.g. Edit Carousel re-run on the same video).
   */
  existingTranscript?: TranscriptSegment[];
  /** Optional brand / voice / facts text for LLM slide copy (from Settings). */
  copyContext?: string;
  /** Appended after AI caption body, before trailing hashtag lines (Settings). */
  defaultCaptionCta?: string;
  /** Optional angle for this carousel generation (main studio text box). */
  carouselFocus?: string;
  /** Saved carousel visual reference (LLM + slide overlay colors). */
  visualReferenceCarousel?: VisualReferenceProfile | null;
  /** Saved photo / feed still reference (LLM for caption + classification). */
  visualReferencePhoto?: VisualReferenceProfile | null;
  /** Optional brightness / hue / saturation on extracted frames and background still. */
  frameColorAdjust?: FrameColorAdjust | null;
  /**
   * Reference still with visible text overlay; vision infers fill/stroke/weight for renders.
   * Requires `openaiApiKey` and does not run in stub LLM mode.
   */
  styleReferenceImagePath?: string;
}

export interface PipelineResult {
  recommendation: CarouselRecommendation;
  effectiveType: CarouselType;
  transcript: TranscriptSegment[];
  slides: SlidePlan[];
  /** Instagram/Facebook-style post caption (AI + editable in UI). */
  socialCaption: string;
  pngBuffers: Buffer[];
  zipBuffer: Buffer;
  firstSlidePng: Buffer | null;
  durationSec: number;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const workDir = path.join(tmpdir(), `v2c-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const durationSec = await probeDurationSec(input.videoPath);

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
        durationProbed: durationSec,
      });
      transcript = t;
    }

    let slideCanvasStyleVision: SlideCanvasTextStyle | undefined;
    let styleVisionForPrompt = "";
    if (
      input.styleReferenceImagePath &&
      input.openaiApiKey &&
      input.openaiApiKey !== "stub"
    ) {
      try {
        const v = await extractCarouselTextStyleFromImagePath(
          input.styleReferenceImagePath,
          input.openaiApiKey
        );
        slideCanvasStyleVision = slideCanvasStyleFromVision(v);
        styleVisionForPrompt = visionStyleLlmAppendix(v);
      } catch (e) {
        console.error("styleReferenceImagePath vision failed:", e);
      }
    }

    const visualReferencePrompt = joinVisualReferencePrompts([
      input.visualReferenceCarousel
        ? `### Carousel slide reference\n${formatVisualReferenceForLlm(input.visualReferenceCarousel)}`
        : "",
      input.visualReferencePhoto
        ? `### Feed / single-photo reference\n${formatVisualReferenceForLlm(input.visualReferencePhoto)}`
        : "",
      styleVisionForPrompt || undefined,
    ]);

    let recommendation: CarouselRecommendation;
    if (input.useStubLlm) {
      recommendation = {
        recommendedType: "example_breakdown",
        confidence: "low",
        rationale: "Stub mode: no API classification.",
      };
    } else {
      recommendation = await recommendCarouselType(
        transcript,
        input.title,
        input.hint,
        input.openaiApiKey,
        {
          copyContext: input.copyContext,
          visualReferencePrompt: visualReferencePrompt || undefined,
          carouselFocus: input.carouselFocus,
        }
      );
    }

    const effectiveType: CarouselType =
      input.carouselTypeOverride && input.carouselTypeOverride.length > 0
        ? input.carouselTypeOverride
        : recommendation.recommendedType;

    let slides: SlidePlan[];
    if (input.useStubLlm) {
      slides = stubSlidesFromTranscript(transcript);
    } else {
      // Generate-validate-retry loop. The validator catches failure modes the prompt
      // cannot reliably enforce on long inputs (tease bodies, vague phrases, duplicate
      // ideas, no-corrective-action carousels) and re-feeds its complaints to the
      // model as targeted feedback for one or two retries. If the validator still
      // fails after MAX_ATTEMPTS we ship the last attempt anyway and log the residual
      // issues — better to ship a flawed carousel than to fail the whole pipeline.
      const MAX_ATTEMPTS = 3;
      let validatorFeedback: string | undefined;
      let lastSlides: SlidePlan[] = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        lastSlides = await generateSlides(
          transcript,
          effectiveType,
          input.title,
          input.hint,
          input.openaiApiKey,
          {
            copyContext: input.copyContext,
            visualReferencePrompt: visualReferencePrompt || undefined,
            carouselFocus: input.carouselFocus,
            validatorFeedback,
          }
        );
        const result = validateSlides(lastSlides);
        if (result.ok) {
          if (attempt > 1) {
            console.log(
              `[slides] validator passed on attempt ${attempt}/${MAX_ATTEMPTS}`
            );
          }
          break;
        }
        const summary = result.errors
          .map((e) => `${e.rule}@slide${e.slideOrder}`)
          .join(", ");
        console.log(
          `[slides] attempt ${attempt}/${MAX_ATTEMPTS} validator caught ${result.errors.length} issue(s): ${summary}`
        );
        if (attempt === MAX_ATTEMPTS) {
          console.log(
            `[slides] max attempts reached; shipping last attempt with residual issues.`
          );
          break;
        }
        validatorFeedback = result.feedbackForRetry;
      }
      slides = lastSlides;
    }

    if (slides.length === 0) {
      slides = stubSlidesFromTranscript(transcript);
    }

    slides = normalizeSlidesForKeyframes(slides, transcript);

    const durationEffective = effectiveDurationSec(durationSec, transcript);

    const socialCaptionPromise = input.useStubLlm
      ? Promise.resolve(STUB_CAROUSEL_SOCIAL_CAPTION)
      : generateCarouselSocialCaption(
          transcript,
          slides,
          input.title,
          input.hint,
          effectiveType,
          input.openaiApiKey,
          {
            copyContext: input.copyContext,
            visualReferencePrompt: visualReferencePrompt || undefined,
            carouselFocus: input.carouselFocus,
          }
        );

    const slideCanvasStyle: SlideCanvasTextStyle =
      slideCanvasStyleVision ??
      mergedStudioSlideStyleWithProfileAccent(
        deriveOverlayColorsFromProfile(
          input.visualReferenceCarousel ?? undefined
        )
      );

    const [rendered, socialCaption] = await Promise.all([
      renderSlidesToZip({
        videoPath: input.videoPath,
        slides,
        transcript,
        layoutId: input.layoutId,
        brandingId: input.brandingId,
        backgroundImagePath: input.backgroundImagePath,
        slideCanvasStyle,
        frameColorAdjust: input.frameColorAdjust ?? null,
      }),
      socialCaptionPromise,
    ]);

    const rawSocial = socialCaption.trim();

    return {
      recommendation,
      effectiveType,
      transcript,
      slides,
      socialCaption: applyCaptionCtaAndCap(rawSocial, input.defaultCaptionCta),
      pngBuffers: [],
      zipBuffer: rendered.zipBuffer,
      firstSlidePng: rendered.firstSlidePng,
      durationSec: durationEffective,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
