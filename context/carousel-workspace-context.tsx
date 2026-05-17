"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  CarouselType,
  LayoutId,
  SocialMicroSnapshot,
} from "@/lib/types";
import {
  getCarouselFocusFromStorage,
  MAX_CAROUSEL_FOCUS_CHARS,
  mergeCopyContextWithStudioRunNotes,
  setCarouselFocusToStorage,
} from "@/lib/carousel-focus";
import { getShortEditorialNotesFromStorage } from "@/lib/short-editorial-notes-storage";
import { getStudioShortPipelineSettingsFromStorage } from "@/lib/studio-short-pipeline-settings";
import { mergeShortEditorialBriefParts } from "@/lib/merge-short-editorial-brief";
import {
  getCopyContextFromStorage,
  MAX_COPY_CONTEXT_CHARS,
} from "@/lib/copy-context";
import {
  MAX_COPY_FEEDBACK_CHARS,
  getCopyFeedbackFromStorage,
} from "@/lib/copy-feedback";
import {
  MAX_REFERENCE_SOURCES_CHARS,
  getReferenceSourcesFromStorage,
} from "@/lib/reference-sources";
import {
  getDefaultCaptionCtaFromStorage,
  MAX_DEFAULT_CAPTION_CTA_CHARS,
} from "@/lib/default-caption-cta";
import {
  appendLearnedFromEditsLines,
  buildCarouselLearningLines,
  cloneSlidesForLearningBaseline,
  getLearnedFromEditsBlob,
  mergeCopyContextWithLearnings,
} from "@/lib/learned-from-edits";
import { appendVisualReferenceFormFields } from "@/lib/visual-reference-storage";
import { clientApiPath } from "@/lib/client-api-path";
import { parseResponseJson } from "@/lib/parse-response-json";
import {
  editorialFieldsFromJobPoll,
  fetchJobPollState,
  getShortOutputFileName,
  reprocessVideoToShortJob,
  runVideoToShortIfEnabled,
  type StudioShortTextOptions,
} from "@/lib/run-video-to-short";
import { isLikelyVideoFile } from "@/lib/is-likely-video-file";
import { incrementVideosMultiplied } from "@/lib/hub/metrics-store";
import {
  DEFAULT_FRAME_COLOR_ADJUST,
  clampFrameColorAdjust,
  type FrameColorAdjust,
} from "@/lib/frame-color-adjust";

const DEFAULT_BRANDING_ID = "default";

export type { FrameColorAdjust };

/** Dynamic import keeps JSZip out of the main client chunk and avoids webpack HMR/module factory issues. */
async function extractCarouselSlidePreviewsFromZipSafe(zipBase64: string) {
  const { extractCarouselSlidePreviewsFromZip } = await import(
    "@/lib/zip-slide-previews"
  );
  return extractCarouselSlidePreviewsFromZip(zipBase64);
}

export type ApiSlide = {
  order: number;
  role?: string;
  hookStyle?: string;
  headline: string;
  body?: string;
  evidenceSegmentIds: number[];
};

export type ApiRecommendation = {
  recommendedType: CarouselType;
  confidence: string;
  rationale: string;
  runnerUp?: CarouselType;
};

export const CAROUSEL_LABELS: Record<CarouselType, string> = {
  listical: "Fix a mistake",
  step_by_step: "Show how to do it",
  example_breakdown: "Break it down",
  belief_shifting: "Change how you think",
};

export const CAROUSEL_TYPES = Object.keys(CAROUSEL_LABELS) as CarouselType[];

export function isCarouselType(s: string): s is CarouselType {
  return CAROUSEL_TYPES.includes(s as CarouselType);
}

export function carouselLabel(t: string | undefined): string {
  if (!t) return "";
  return isCarouselType(t) ? CAROUSEL_LABELS[t] : t;
}

export type BackgroundSource = "video_moments" | "own_background";

export const POST_STYLE_TYPE_ORDER: CarouselType[] = [
  "listical",
  "step_by_step",
  "example_breakdown",
  "belief_shifting",
];

const PROCESS_DEFAULTS = {
  layoutId: "stacked_center" as LayoutId,
  carouselOverride: "" as CarouselType | "",
  backgroundSource: "video_moments" as BackgroundSource,
  frameColorAdjust: DEFAULT_FRAME_COLOR_ADJUST,
};

/** Safe download name: `My Clip.mp4` → `My Clip_carousel.zip` */
function carouselZipFilename(videoFileName: string): string {
  const withoutExt = videoFileName.replace(/\.[^/.]+$/i, "").trim() || "video";
  const safe = withoutExt
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const base = safe || "video";
  return `${base}_carousel.zip`;
}

/** Per-run toggles for which deliverables to generate after upload or on “Regenerate”. */
export type StudioOutputToggles = {
  carousel: boolean;
  imagePost: boolean;
  xPost: boolean;
  reelShort: boolean;
};

const DEFAULT_STUDIO_OUTPUTS: StudioOutputToggles = {
  carousel: true,
  imagePost: true,
  xPost: true,
  reelShort: true,
};

export type VideoQueueItem = {
  id: string;
  /**
   * Original upload only. Carousel (`/api/process`), transcribe, re-render, and
   * image post always send this file — never `shortOutputFile`. Do not replace
   * this with the Video to Short export or keyframes will pick up burned-in captions.
   */
  file: File;
  /** Optional per-video run notes for AI (stitch handoff or custom enqueue). */
  aiInstructions?: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  /** Latest Video to Short / pipeline step message while processing. */
  progress?: string;
  /** Video to Short export when it ran and returned a distinct file; preview/download only. */
  shortOutputFile?: File | null;
  /** Short API job id for re-process (same session / backend still has upload). */
  shortJobId?: string | null;
  /**
   * Editorial pass result, surfaced from the backend's final job state. Lets the home
   * page show the user *what the AI did or skipped* without making them dig through
   * DevTools — e.g. "Removed 2 regions (≈4.1s)" vs "Smart editorial was skipped (no OpenAI API key)".
   */
  shortEditorialSummary?: string | null;
  shortEditorialSkip?: string | null;
  /** Per-cut smart editorial detail from Video to Short job JSON (`editorial_cuts`). */
  shortEditorialCuts?: unknown | null;
};

/** Single-frame 4:5 Instagram image post from the same video as the carousel. */
export type ImagePostSnapshot = {
  hook: string;
  microCta: string;
  caption: string;
  altText: string;
  evidenceSegmentIds: number[];
  transcript: {
    id: number;
    text: string;
    startSec: number;
    endSec: number;
  }[];
  durationSec: number;
  frameTimeSec: number;
  imageBase64: string;
};

/** Server + client timings for carousel pipeline (and optional full queue run). */
export type ProcessTiming = {
  /** Server: multipart stream saved to disk (ms). */
  uploadIngestMs?: number;
  /** Server: Whisper + LLM + slide render + zip after ingest (ms). */
  serverPipelineMs?: number;
  /** Browser: `/api/transcribe` (when used) + `/api/process` + `/api/image-post/process` + `/api/social-micro/generate` + ZIP preview decode (ms). */
  clientCarouselAndImageMs?: number;
  /** Browser: from queue “processing” through Short + transcript + carousel + image (ms). */
  fullQueueProcessMs?: number;
};

export type QueueCarouselSnapshot = {
  recommendation: ApiRecommendation | null;
  effectiveType: CarouselType | null;
  editableSlides: ApiSlide[];
  transcript: {
    id: number;
    text: string;
    startSec: number;
    endSec: number;
  }[];
  durationSec: number | null;
  zipBase64: string | null;
  firstSlidePreviewBase64: string | null;
  slidePreviewBase64s: string[] | null;
  /** 1080×1350 (4:5) slides; null if ZIP has no instagram folder. */
  slidePreviewBase64sInstagram?: string[] | null;
  /** AI-written Instagram/Facebook post caption; user-editable. */
  socialCaption: string;
  layoutId: LayoutId;
  carouselOverride: CarouselType | "";
  backgroundSource: BackgroundSource;
  backgroundFile: File | null;
  imagePost: ImagePostSnapshot | null;
  imagePostError: string | null;
  /** X (Twitter) thread + Threads posts from transcript; null until generated or on failure to attach. */
  socialMicro: SocialMicroSnapshot | null;
  socialMicroError: string | null;
  processTiming?: ProcessTiming | null;
  /** Brightness / hue / saturation applied to carousel frames and image-post source frame. */
  frameColorAdjust: FrameColorAdjust;
};

type CarouselWorkspaceValue = {
  queue: VideoQueueItem[];
  activeQueueId: string | null;
  selectQueueItem: (id: string) => void;
  enqueueFiles: (
    files: File[],
    opts?: { aiInstructionsByIndex?: Array<string | undefined> }
  ) => void;
  file: File | null;
  /** Short pipeline output for the active queue row, if any (not used for carousel/image). */
  shortOutputFile: File | null;
  /** Video to Short job id for the active row (re-process). */
  shortJobId: string | null;
  /** Editorial summary for the active row's Short pipeline run, if applicable. */
  shortEditorialSummary: string | null;
  shortEditorialSkip: string | null;
  shortEditorialCuts: unknown | null;
  shortReprocessBusy: boolean;
  reprocessActiveShortOutput: (text: StudioShortTextOptions) => Promise<void>;
  layoutId: LayoutId;
  setLayoutId: (v: LayoutId) => void;
  carouselOverride: CarouselType | "";
  setCarouselOverride: (v: CarouselType | "") => void;
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  recommendation: ApiRecommendation | null;
  effectiveType: CarouselType | null;
  editableSlides: ApiSlide[];
  transcript: {
    id: number;
    text: string;
    startSec: number;
    endSec: number;
  }[];
  durationSec: number | null;
  zipBase64: string | null;
  firstSlidePreviewBase64: string | null;
  slidePreviewBase64s: string[] | null;
  slidePreviewBase64sInstagram: string[] | null;
  socialCaption: string;
  setSocialCaption: (v: string) => void;
  reRenderLoading: boolean;
  backgroundSource: BackgroundSource;
  setBackgroundSource: (v: BackgroundSource) => void;
  backgroundFile: File | null;
  setBackgroundFile: (f: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  backgroundInputRef: React.RefObject<HTMLInputElement | null>;
  generateCarousel: (options?: { defaultsOnly?: boolean }) => Promise<void>;
  updateSlide: (
    index: number,
    field: "headline" | "body",
    value: string
  ) => void;
  removeSlide: (index: number) => void;
  addSlide: () => void;
  reRenderZip: () => Promise<void>;
  downloadZip: () => void;
  /** Bundle every completed queue item’s carousel zip into one download (needs ≥2 finished videos). */
  downloadAllZips: () => Promise<void>;
  downloadAllZipsLoading: boolean;
  /** True when at least two queue rows are Done (enables bulk download). */
  canDownloadAllZips: boolean;
  clearWorkspaceForNewVideo: () => void;
  imagePost: ImagePostSnapshot | null;
  imagePostError: string | null;
  imagePostBusy: boolean;
  patchImagePost: (patch: Partial<ImagePostSnapshot>) => void;
  downloadImagePostPng: () => void;
  regenerateImagePostCopy: () => Promise<void>;
  rerenderImagePostOverlay: (hook: string, microCta: string) => Promise<boolean>;
  /** Re-render image post with current hook/micro and latest frame color (no LLM). */
  applyImagePostFrameColor: () => Promise<boolean>;
  frameColorAdjust: FrameColorAdjust;
  setFrameColorAdjust: Dispatch<SetStateAction<FrameColorAdjust>>;
  socialMicro: SocialMicroSnapshot | null;
  socialMicroError: string | null;
  socialMicroBusy: boolean;
  regenerateSocialMicro: () => Promise<void>;
  /** Latest saved carousel snapshot per queue row (active row may need `flushActiveQueueSnapshot` first). */
  queueSnapshots: Record<string, QueueCarouselSnapshot>;
  /** Persist the current editor state onto the active queue item; returns that snapshot when flushed. */
  flushActiveQueueSnapshot: () => QueueCarouselSnapshot | null;
  /** Latest measured process timings for the active row (after generate or queue done). */
  processTiming: ProcessTiming | null;
  /** Which outputs to generate for new uploads and for “Regenerate” (Short only applies on upload). */
  studioOutputs: StudioOutputToggles;
  setStudioOutputs: Dispatch<SetStateAction<StudioOutputToggles>>;
};

const CarouselWorkspaceContext = createContext<CarouselWorkspaceValue | null>(
  null
);

async function postProcessAndBuildSnapshot(
  videoFile: File,
  opts: {
    layoutId: LayoutId;
    carouselOverride: CarouselType | "";
    backgroundSource: BackgroundSource;
    backgroundFile: File | null;
    frameColorAdjust?: FrameColorAdjust;
    /** Skip Whisper when re-running process with the same video + transcript (Edit Carousel). */
    reuseTranscription?: boolean;
    existingTranscript?: {
      id: number;
      text: string;
      startSec: number;
      endSec: number;
    }[];
  },
  backgroundInputRef: RefObject<HTMLInputElement | null>
): Promise<QueueCarouselSnapshot> {
  const bgSource = opts.backgroundSource;
  const bgFile =
    bgSource === "own_background"
      ? opts.backgroundFile ?? backgroundInputRef.current?.files?.[0] ?? null
      : null;

  const fd = new FormData();
  fd.append("video", videoFile);
  if (bgSource === "own_background" && bgFile) {
    fd.append("background", bgFile);
  }
  fd.append("layoutId", opts.layoutId);
  fd.append("brandingId", DEFAULT_BRANDING_ID);
  if (opts.carouselOverride) fd.append("carouselType", opts.carouselOverride);
  if (
    opts.reuseTranscription &&
    opts.existingTranscript &&
    opts.existingTranscript.length > 0
  ) {
    fd.append("reuseTranscription", "1");
    fd.append("transcript", JSON.stringify(opts.existingTranscript));
  }

  const copyCtx = getCopyContextFromStorage().trim();
  const learned = getLearnedFromEditsBlob().trim();
  const mergedCopy = mergeCopyContextWithLearnings(
    copyCtx || undefined,
    learned || undefined
  );
  if (mergedCopy) {
    fd.append("copyContext", mergedCopy.slice(0, MAX_COPY_CONTEXT_CHARS));
  }
  const defaultCaptionCta = getDefaultCaptionCtaFromStorage().trim();
  if (defaultCaptionCta) {
    fd.append(
      "defaultCaptionCta",
      defaultCaptionCta.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS)
    );
  }
  const carouselFocus = getCarouselFocusFromStorage().trim();
  if (carouselFocus) {
    fd.append(
      "carouselFocus",
      carouselFocus.slice(0, MAX_CAROUSEL_FOCUS_CHARS)
    );
  }
  appendVisualReferenceFormFields(fd);
  fd.append(
    "frameColorAdjust",
    JSON.stringify(opts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST)
  );

  const res = await fetch(clientApiPath("/api/process"), {
    method: "POST",
    body: fd,
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      res.ok
        ? "Invalid response from server."
        : `Request failed (${res.status}).`
    );
  }
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Request failed"
    );
  }
  if (
    typeof data.recommendation !== "object" ||
    data.recommendation === null ||
    Array.isArray(data.recommendation) ||
    typeof data.effectiveType !== "string" ||
    !isCarouselType(data.effectiveType)
  ) {
    throw new Error("Incomplete response from server.");
  }
  const rec = data.recommendation as Record<string, unknown>;
  const recType = rec.recommendedType;
  if (typeof recType !== "string" || !isCarouselType(recType)) {
    throw new Error("Incomplete response from server.");
  }

  const recommendation = data.recommendation as ApiRecommendation;
  const effectiveType = data.effectiveType as CarouselType;
  const slidesRaw = data.slides;
  const editableSlides = Array.isArray(slidesRaw)
    ? (slidesRaw as ApiSlide[])
    : [];
  const tr = data.transcript;
  const transcript = Array.isArray(tr)
    ? (tr as {
        id: number;
        text: string;
        startSec: number;
        endSec: number;
      }[])
    : [];
  const durationSec =
    typeof data.durationSec === "number" ? data.durationSec : null;
  const z = typeof data.zipBase64 === "string" ? data.zipBase64 : null;
  const first =
    typeof data.firstSlidePreviewBase64 === "string"
      ? data.firstSlidePreviewBase64
      : null;

  let slidePreviewBase64s: string[] | null = null;
  let slidePreviewBase64sInstagram: string[] | null = null;
  if (z) {
    try {
      const { youtube, instagram } =
        await extractCarouselSlidePreviewsFromZipSafe(z);
      slidePreviewBase64s =
        youtube.length > 0 ? youtube : first ? [first] : null;
      slidePreviewBase64sInstagram =
        instagram.length > 0 ? instagram : null;
    } catch {
      slidePreviewBase64s = first ? [first] : null;
      slidePreviewBase64sInstagram = null;
    }
  } else {
    slidePreviewBase64s = first ? [first] : null;
    slidePreviewBase64sInstagram = null;
  }

  const socialCaption =
    typeof data.socialCaption === "string" ? data.socialCaption : "";

  const uploadIngestMs =
    typeof data.uploadIngestMs === "number" ? data.uploadIngestMs : undefined;
  const serverPipelineMs =
    typeof data.serverPipelineMs === "number"
      ? data.serverPipelineMs
      : undefined;
  const processTiming: ProcessTiming | null =
    uploadIngestMs !== undefined || serverPipelineMs !== undefined
      ? { uploadIngestMs, serverPipelineMs }
      : null;

  return {
    recommendation,
    effectiveType,
    editableSlides,
    transcript,
    durationSec,
    zipBase64: z,
    firstSlidePreviewBase64: first,
    slidePreviewBase64s,
    slidePreviewBase64sInstagram,
    socialCaption,
    layoutId: opts.layoutId,
    carouselOverride: opts.carouselOverride,
    backgroundSource: opts.backgroundSource,
    backgroundFile: bgSource === "own_background" ? bgFile : null,
    imagePost: null,
    imagePostError: null,
    socialMicro: null,
    socialMicroError: null,
    processTiming,
    frameColorAdjust: opts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
  };
}

async function postSocialMicroFromTranscript(
  transcript: QueueCarouselSnapshot["transcript"]
): Promise<SocialMicroSnapshot> {
  const copyCtx = getCopyContextFromStorage().trim();
  const learnedBlob = getLearnedFromEditsBlob().trim();
  const merged = mergeCopyContextWithStudioRunNotes(
    mergeCopyContextWithLearnings(
      copyCtx || undefined,
      learnedBlob || undefined
    )
  );
  const res = await fetch(clientApiPath("/api/social-micro/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      copyContext: merged
        ? merged.slice(0, MAX_COPY_CONTEXT_CHARS)
        : undefined,
    }),
  });
  const data = await parseResponseJson<
    SocialMicroSnapshot & { error?: string }
  >(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Social copy failed"
    );
  }
  if (
    !Array.isArray(data.twitterThread) ||
    !Array.isArray(data.threadsPosts)
  ) {
    throw new Error("Incomplete social copy response.");
  }
  return {
    twitterThread: data.twitterThread,
    threadsPosts: data.threadsPosts,
    threadsVisualSuggestion: String(
      data.threadsVisualSuggestion ?? ""
    ).trim(),
  };
}

async function postImagePostFromVideo(
  videoFile: File,
  transcript: QueueCarouselSnapshot["transcript"],
  options?: {
    previousPlan?: {
      hook: string;
      microCta: string;
      caption: string;
      altText: string;
    };
    frameColorAdjust?: FrameColorAdjust;
  }
): Promise<ImagePostSnapshot> {
  const fd = new FormData();
  fd.append("video", videoFile);
  const copyCtx = getCopyContextFromStorage().trim();
  const learnedBlob = getLearnedFromEditsBlob().trim();
  const mergedImgCopy = mergeCopyContextWithStudioRunNotes(
    mergeCopyContextWithLearnings(
      copyCtx || undefined,
      learnedBlob || undefined
    )
  );
  if (mergedImgCopy) {
    fd.append("copyContext", mergedImgCopy.slice(0, MAX_COPY_CONTEXT_CHARS));
  }
  const defaultCaptionCta = getDefaultCaptionCtaFromStorage().trim();
  if (defaultCaptionCta) {
    fd.append(
      "defaultCaptionCta",
      defaultCaptionCta.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS)
    );
  }
  appendVisualReferenceFormFields(fd);
  fd.append(
    "frameColorAdjust",
    JSON.stringify(
      options?.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST
    )
  );
  const sources = getReferenceSourcesFromStorage().trim();
  if (sources) {
    fd.append(
      "referenceSources",
      sources.slice(0, MAX_REFERENCE_SOURCES_CHARS)
    );
  }
  const feedback = getCopyFeedbackFromStorage().trim();
  if (feedback) {
    fd.append("copyFeedback", feedback.slice(0, MAX_COPY_FEEDBACK_CHARS));
  }
  if (transcript.length > 0) {
    fd.append("reuseTranscription", "1");
    fd.append("transcript", JSON.stringify(transcript));
  }
  const prev = options?.previousPlan;
  if (feedback && prev) {
    fd.append(
      "previousPlan",
      JSON.stringify({
        hook: prev.hook,
        microCta: prev.microCta,
        caption: prev.caption,
        altText: prev.altText,
      })
    );
  }

  const res = await fetch(clientApiPath("/api/image-post/process"), {
    method: "POST",
    body: fd,
  });
  const data = await parseResponseJson<
    ImagePostSnapshot & { error?: string }
  >(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Image post failed"
    );
  }
  if (typeof data.imageBase64 !== "string" || !data.imageBase64) {
    throw new Error("Incomplete image post response.");
  }
  return {
    hook: String(data.hook ?? ""),
    microCta: String(data.microCta ?? ""),
    caption: String(data.caption ?? ""),
    altText: String(data.altText ?? ""),
    evidenceSegmentIds: Array.isArray(data.evidenceSegmentIds)
      ? (data.evidenceSegmentIds as number[])
      : [],
    transcript: Array.isArray(data.transcript)
      ? (data.transcript as ImagePostSnapshot["transcript"])
      : transcript,
    durationSec: typeof data.durationSec === "number" ? data.durationSec : 0,
    frameTimeSec: typeof data.frameTimeSec === "number" ? data.frameTimeSec : 0,
    imageBase64: data.imageBase64,
  };
}

async function postVideoTranscript(
  videoFile: File
): Promise<QueueCarouselSnapshot["transcript"]> {
  const fd = new FormData();
  fd.append("video", videoFile);
  const res = await fetch(clientApiPath("/api/transcribe"), {
    method: "POST",
    body: fd,
  });
  const data = await parseResponseJson<{
    transcript?: QueueCarouselSnapshot["transcript"];
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Transcription failed"
    );
  }
  const tr = data.transcript;
  if (!Array.isArray(tr) || tr.length === 0) {
    throw new Error("Transcription returned no segments.");
  }
  return tr;
}

type StudioParallelOutputs = {
  carousel: boolean;
  imagePost: boolean;
  social: boolean;
};

function buildSkippedCarouselSnapshot(
  transcript: QueueCarouselSnapshot["transcript"],
  opts: {
    layoutId: LayoutId;
    carouselOverride: CarouselType | "";
    backgroundSource: BackgroundSource;
    backgroundFile: File | null;
    frameColorAdjust?: FrameColorAdjust;
  }
): QueueCarouselSnapshot {
  const durationSec =
    transcript.length > 0
      ? Math.max(...transcript.map((s) => s.endSec))
      : null;
  const bgSource = opts.backgroundSource;
  const bgFile =
    bgSource === "own_background" ? opts.backgroundFile : null;
  return {
    recommendation: null,
    effectiveType: null,
    editableSlides: [],
    transcript,
    durationSec,
    zipBase64: null,
    firstSlidePreviewBase64: null,
    slidePreviewBase64s: null,
    slidePreviewBase64sInstagram: null,
    socialCaption: "",
    layoutId: opts.layoutId,
    carouselOverride: opts.carouselOverride,
    backgroundSource: opts.backgroundSource,
    backgroundFile: bgSource === "own_background" ? bgFile : null,
    imagePost: null,
    imagePostError: null,
    socialMicro: null,
    socialMicroError: null,
    processTiming: null,
    frameColorAdjust: opts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
  };
}

async function postCarouselAndImagePost(
  videoFile: File,
  opts: Parameters<typeof postProcessAndBuildSnapshot>[1] & {
    outputs?: StudioParallelOutputs;
  },
  backgroundInputRef: RefObject<HTMLInputElement | null>
): Promise<QueueCarouselSnapshot> {
  const clientT0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const outputs: StudioParallelOutputs = opts.outputs ?? {
    carousel: true,
    imagePost: true,
    social: true,
  };

  const reuse =
    opts.reuseTranscription === true &&
    Array.isArray(opts.existingTranscript) &&
    opts.existingTranscript.length > 0;

  const sharedTranscript: QueueCarouselSnapshot["transcript"] = reuse
    ? opts.existingTranscript!
    : await postVideoTranscript(videoFile);

  const parallelOpts = {
    ...opts,
    reuseTranscription: true,
    existingTranscript: sharedTranscript,
  };

  const carouselP = outputs.carousel
    ? postProcessAndBuildSnapshot(videoFile, parallelOpts, backgroundInputRef)
    : Promise.resolve(
        buildSkippedCarouselSnapshot(sharedTranscript, {
          layoutId: parallelOpts.layoutId,
          carouselOverride: parallelOpts.carouselOverride,
          backgroundSource: parallelOpts.backgroundSource,
          backgroundFile: parallelOpts.backgroundFile,
          frameColorAdjust:
            parallelOpts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
        })
      );

  const imageP = outputs.imagePost
    ? postImagePostFromVideo(videoFile, sharedTranscript, {
        frameColorAdjust:
          parallelOpts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
      })
    : Promise.resolve(null as ImagePostSnapshot | null);

  const socialP = outputs.social
    ? postSocialMicroFromTranscript(sharedTranscript)
    : Promise.resolve(null as SocialMicroSnapshot | null);

  const [carouselSettled, imageSettled, socialSettled] =
    await Promise.allSettled([carouselP, imageP, socialP]);

  if (carouselSettled.status === "rejected") {
    throw carouselSettled.reason;
  }
  const carousel = carouselSettled.value;

  let imagePost: ImagePostSnapshot | null;
  let imagePostError: string | null;
  if (imageSettled.status === "fulfilled") {
    imagePost = imageSettled.value;
    imagePostError = null;
  } else {
    imagePost = null;
    const reason = imageSettled.reason;
    imagePostError =
      reason instanceof Error
        ? reason.message
        : "Could not generate image post.";
  }

  let socialMicro: SocialMicroSnapshot | null;
  let socialMicroError: string | null;
  if (socialSettled.status === "fulfilled") {
    socialMicro = socialSettled.value;
    socialMicroError = null;
  } else {
    socialMicro = null;
    const reason = socialSettled.reason;
    socialMicroError =
      reason instanceof Error
        ? reason.message
        : "Could not generate Twitter/Threads copy.";
  }

  const clientCarouselAndImageMs = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      clientT0
  );

  return {
    ...carousel,
    imagePost,
    imagePostError,
    socialMicro,
    socialMicroError,
    processTiming: {
      ...(carousel.processTiming ?? {}),
      clientCarouselAndImageMs,
    },
  };
}

export function CarouselWorkspaceProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<VideoQueueItem[]>([]);
  const [queueResults, setQueueResults] = useState<
    Record<string, QueueCarouselSnapshot>
  >({});
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);

  const [layoutId, setLayoutId] = useState<LayoutId>("stacked_center");
  const [carouselOverride, setCarouselOverride] = useState<CarouselType | "">(
    ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<ApiRecommendation | null>(
    null
  );
  const [effectiveType, setEffectiveType] = useState<CarouselType | null>(null);
  const [editableSlides, setEditableSlides] = useState<ApiSlide[]>([]);
  /** Latest slide copy for re-render; avoids a stale `reRenderZip` closure missing the last keystroke. */
  const editableSlidesRef = useRef<ApiSlide[]>([]);
  /** Headline/body snapshot for auto-diff learnings when user rebuilds slide images. */
  const carouselTextBaselineForLearningRef = useRef<
    ReturnType<typeof cloneSlidesForLearningBaseline>
  >([]);
  const [transcript, setTranscript] = useState<
    { id: number; text: string; startSec: number; endSec: number }[]
  >([]);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [zipBase64, setZipBase64] = useState<string | null>(null);
  const [firstSlidePreviewBase64, setFirstSlidePreviewBase64] = useState<
    string | null
  >(null);
  const [slidePreviewBase64s, setSlidePreviewBase64s] = useState<
    string[] | null
  >(null);
  const [slidePreviewBase64sInstagram, setSlidePreviewBase64sInstagram] =
    useState<string[] | null>(null);
  const [socialCaption, setSocialCaption] = useState("");
  const [reRenderLoading, setReRenderLoading] = useState(false);
  const [downloadAllZipsLoading, setDownloadAllZipsLoading] = useState(false);
  const [shortReprocessBusy, setShortReprocessBusy] = useState(false);
  const [backgroundSource, setBackgroundSource] =
    useState<BackgroundSource>("video_moments");
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [imagePost, setImagePost] = useState<ImagePostSnapshot | null>(null);
  const [imagePostError, setImagePostError] = useState<string | null>(null);
  const [imagePostBusy, setImagePostBusy] = useState(false);
  const [socialMicro, setSocialMicro] = useState<SocialMicroSnapshot | null>(
    null
  );
  const [socialMicroError, setSocialMicroError] = useState<string | null>(null);
  const [socialMicroBusy, setSocialMicroBusy] = useState(false);
  const [processTiming, setProcessTiming] = useState<ProcessTiming | null>(null);
  const [frameColorAdjust, setFrameColorAdjust] = useState<FrameColorAdjust>(
    DEFAULT_FRAME_COLOR_ADJUST
  );
  const frameColorAdjustRef = useRef<FrameColorAdjust>(DEFAULT_FRAME_COLOR_ADJUST);
  const imagePostFrameTimeRef = useRef<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  const queueRef = useRef<VideoQueueItem[]>([]);
  const queueResultsRef = useRef<Record<string, QueueCarouselSnapshot>>({});
  const processingQueueRef = useRef(false);
  const activeQueueIdRef = useRef<string | null>(null);
  /** Prevents overlapping Short re-process runs (e.g. double-click before React re-renders). */
  const shortReprocessInFlightRef = useRef(false);

  const [studioOutputs, setStudioOutputs] =
    useState<StudioOutputToggles>(DEFAULT_STUDIO_OUTPUTS);
  const studioOutputsRef = useRef<StudioOutputToggles>(DEFAULT_STUDIO_OUTPUTS);

  useEffect(() => {
    studioOutputsRef.current = studioOutputs;
  }, [studioOutputs]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    queueResultsRef.current = queueResults;
  }, [queueResults]);
  useEffect(() => {
    activeQueueIdRef.current = activeQueueId;
  }, [activeQueueId]);
  useEffect(() => {
    editableSlidesRef.current = editableSlides;
  }, [editableSlides]);
  useEffect(() => {
    imagePostFrameTimeRef.current = imagePost?.frameTimeSec;
  }, [imagePost?.frameTimeSec]);
  useEffect(() => {
    frameColorAdjustRef.current = frameColorAdjust;
  }, [frameColorAdjust]);

  const buildSnapshotFromWorkspace = useCallback((): QueueCarouselSnapshot => {
    return {
      recommendation,
      effectiveType,
      editableSlides,
      transcript,
      durationSec,
      zipBase64,
      firstSlidePreviewBase64,
      slidePreviewBase64s,
      slidePreviewBase64sInstagram,
      socialCaption,
      layoutId,
      carouselOverride,
      backgroundSource,
      backgroundFile,
      imagePost,
      imagePostError,
      socialMicro,
      socialMicroError,
      processTiming,
      frameColorAdjust,
    };
  }, [
    recommendation,
    effectiveType,
    editableSlides,
    transcript,
    durationSec,
    zipBase64,
    firstSlidePreviewBase64,
    slidePreviewBase64s,
    slidePreviewBase64sInstagram,
    socialCaption,
    layoutId,
    carouselOverride,
    backgroundSource,
    backgroundFile,
    imagePost,
    imagePostError,
    socialMicro,
    socialMicroError,
    processTiming,
    frameColorAdjust,
  ]);

  const flushActiveQueueSnapshot = useCallback((): QueueCarouselSnapshot | null => {
    const aid = activeQueueIdRef.current;
    if (!aid) return null;
    const snap = buildSnapshotFromWorkspace();
    setQueueResults((qr) => {
      const next = { ...qr, [aid]: snap };
      queueResultsRef.current = next;
      return next;
    });
    return snap;
  }, [buildSnapshotFromWorkspace]);

  const applySnapshot = useCallback((snap: QueueCarouselSnapshot) => {
    setRecommendation(snap.recommendation);
    setEffectiveType(snap.effectiveType);
    setEditableSlides(snap.editableSlides);
    setTranscript(snap.transcript);
    setDurationSec(snap.durationSec);
    setZipBase64(snap.zipBase64);
    setFirstSlidePreviewBase64(snap.firstSlidePreviewBase64);
    setSlidePreviewBase64s(snap.slidePreviewBase64s);
    setSlidePreviewBase64sInstagram(snap.slidePreviewBase64sInstagram ?? null);
    setSocialCaption(snap.socialCaption ?? "");
    setLayoutId(snap.layoutId);
    setCarouselOverride(snap.carouselOverride);
    setBackgroundSource(snap.backgroundSource);
    setBackgroundFile(snap.backgroundFile);
    setImagePost(snap.imagePost ?? null);
    setImagePostError(snap.imagePostError ?? null);
    setSocialMicro(snap.socialMicro ?? null);
    setSocialMicroError(snap.socialMicroError ?? null);
    setProcessTiming(snap.processTiming ?? null);
    setFrameColorAdjust(
      clampFrameColorAdjust({
        ...DEFAULT_FRAME_COLOR_ADJUST,
        ...(snap.frameColorAdjust ?? {}),
      })
    );
    if (snap.editableSlides.length > 0) {
      carouselTextBaselineForLearningRef.current =
        cloneSlidesForLearningBaseline(snap.editableSlides);
    } else {
      carouselTextBaselineForLearningRef.current = [];
    }
  }, []);

  const clearWorkspaceForNewVideo = useCallback(() => {
    setRecommendation(null);
    setEffectiveType(null);
    setEditableSlides([]);
    setTranscript([]);
    setZipBase64(null);
    setFirstSlidePreviewBase64(null);
    setSlidePreviewBase64s(null);
    setSlidePreviewBase64sInstagram(null);
    setSocialCaption("");
    setDurationSec(null);
    setError(null);
    setImagePost(null);
    setImagePostError(null);
    setSocialMicro(null);
    setSocialMicroError(null);
    setProcessTiming(null);
    setFrameColorAdjust(DEFAULT_FRAME_COLOR_ADJUST);
    carouselTextBaselineForLearningRef.current = [];
  }, []);

  const selectQueueItem = useCallback(
    (id: string) => {
      const prev = activeQueueIdRef.current;
      if (prev === id) return;
      setQueueResults((qr) => {
        let next = qr;
        if (prev && prev !== id) {
          next = { ...qr, [prev]: buildSnapshotFromWorkspace() };
        }
        queueResultsRef.current = next;
        return next;
      });
      setActiveQueueId(id);
      const snap = queueResultsRef.current[id];
      if (snap) {
        applySnapshot(snap);
      } else {
        clearWorkspaceForNewVideo();
      }
    },
    [applySnapshot, buildSnapshotFromWorkspace, clearWorkspaceForNewVideo]
  );

  const processQueueLoop = useCallback(async () => {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    try {
      for (;;) {
        const pending = queueRef.current.find((q) => q.status === "pending");
        if (!pending) break;

        const formats = studioOutputsRef.current;
        const needsTranscript =
          formats.carousel || formats.imagePost || formats.xPost;
        const startProgress =
          formats.reelShort && needsTranscript
            ? "Video to Short + transcription…"
            : formats.reelShort
              ? "Video to Short…"
              : needsTranscript
                ? "Transcribing audio…"
                : "Processing…";

        setQueue((prev) =>
          prev.map((q) =>
            q.id === pending.id
              ? {
                  ...q,
                  status: "processing" as const,
                  progress: startProgress,
                }
              : q
          )
        );
        queueRef.current = queueRef.current.map((q) =>
          q.id === pending.id
            ? {
                ...q,
                status: "processing" as const,
                progress: startProgress,
              }
            : q
        );

        setActiveQueueId((prev) => prev ?? pending.id);
        const prevCarouselNotes = getCarouselFocusFromStorage();

        setError(null);
        setLoading(true);
        try {
          const queueProcessT0 =
            typeof performance !== "undefined" ? performance.now() : Date.now();
          const runNotesFromQueue =
            typeof pending.aiInstructions === "string"
              ? pending.aiInstructions.trim()
              : "";
          if (runNotesFromQueue) {
            // Per-video notes from stitch handoff should drive this queue item only.
            setCarouselFocusToStorage(runNotesFromQueue);
          }
          const editorialFromHome = getShortEditorialNotesFromStorage();
          const shortRunNotes = mergeShortEditorialBriefParts({
            clipInstructions: runNotesFromQueue,
            editorialNotes: editorialFromHome,
            studioCarouselNotes: prevCarouselNotes,
            maxChars: MAX_CAROUSEL_FOCUS_CHARS,
          });
          const shortTextOpts: StudioShortTextOptions = {
            ...(shortRunNotes.length > 0
              ? { editorial_notes: shortRunNotes }
              : {}),
            pipeline: getStudioShortPipelineSettingsFromStorage(),
          };
          const shortP = formats.reelShort
            ? runVideoToShortIfEnabled(
                pending.file,
                (msg) => {
                  setQueue((prev) =>
                    prev.map((q) =>
                      q.id === pending.id ? { ...q, progress: msg } : q
                    )
                  );
                  queueRef.current = queueRef.current.map((q) =>
                    q.id === pending.id ? { ...q, progress: msg } : q
                  );
                },
                shortTextOpts
              )
            : Promise.resolve({
                outputFile: pending.file,
                jobId: null,
                editorialSummary: null,
                editorialSkip: null,
                editorialCuts: null,
              });

          let sharedTranscript: QueueCarouselSnapshot["transcript"] = [];
          if (needsTranscript) {
            sharedTranscript = await postVideoTranscript(pending.file);
          }

          const parallelLabelParts: string[] = [];
          if (formats.carousel) parallelLabelParts.push("carousel");
          if (formats.imagePost) parallelLabelParts.push("image post");
          if (formats.xPost) parallelLabelParts.push("X/Threads");
          if (formats.reelShort) parallelLabelParts.push("Short");
          const parallelProgress =
            parallelLabelParts.length > 0
              ? `Generating ${parallelLabelParts.join(", ")}…`
              : "Finishing…";

          setQueue((prev) =>
            prev.map((q) =>
              q.id === pending.id
                ? { ...q, progress: parallelProgress }
                : q
            )
          );
          queueRef.current = queueRef.current.map((q) =>
            q.id === pending.id
              ? { ...q, progress: parallelProgress }
              : q
          );

          const carouselImageP =
            formats.carousel || formats.imagePost || formats.xPost
              ? postCarouselAndImagePost(
                  pending.file,
                  {
                    layoutId: PROCESS_DEFAULTS.layoutId,
                    carouselOverride: PROCESS_DEFAULTS.carouselOverride,
                    backgroundSource: PROCESS_DEFAULTS.backgroundSource,
                    backgroundFile: null,
                    frameColorAdjust: PROCESS_DEFAULTS.frameColorAdjust,
                    reuseTranscription: true,
                    existingTranscript: sharedTranscript,
                    outputs: {
                      carousel: formats.carousel,
                      imagePost: formats.imagePost,
                      social: formats.xPost,
                    },
                  },
                  backgroundInputRef
                )
              : Promise.resolve(
                  buildSkippedCarouselSnapshot(sharedTranscript, {
                    layoutId: PROCESS_DEFAULTS.layoutId,
                    carouselOverride: PROCESS_DEFAULTS.carouselOverride,
                    backgroundSource: PROCESS_DEFAULTS.backgroundSource,
                    backgroundFile: null,
                    frameColorAdjust: PROCESS_DEFAULTS.frameColorAdjust,
                  })
                );
          const [shortResult, snapBase] = await Promise.all([
            shortP,
            carouselImageP,
          ]);
          const shortFile = shortResult.outputFile;
          const fullQueueProcessMs = Math.round(
            (typeof performance !== "undefined" ? performance.now() : Date.now()) -
              queueProcessT0
          );
          const snap: QueueCarouselSnapshot = {
            ...snapBase,
            processTiming: {
              ...(snapBase.processTiming ?? {}),
              fullQueueProcessMs,
            },
          };
          const shortDeliverable =
            shortFile !== pending.file ? shortFile : undefined;
          const shortJobIdStored =
            typeof shortResult.jobId === "string" &&
            shortResult.jobId.trim().length > 0
              ? shortResult.jobId.trim()
              : undefined;
          /** Keep a reel file for preview/download whenever we have a real job, even if the backend returned the same File reference as the upload. */
          const shortOutputFileStored =
            shortDeliverable ?? (shortJobIdStored ? shortFile : undefined);
          // Editorial fields are propagated even when the Short pipeline didn't
          // return a different file — useful when the LLM reviewed and chose
          // not to cut anything (still informative to surface).
          const shortEditorialSummary = shortResult.editorialSummary ?? null;
          const shortEditorialSkip = shortResult.editorialSkip ?? null;
          const shortEditorialCuts = shortResult.editorialCuts ?? null;
          const wasDone =
            queueRef.current.find((q) => q.id === pending.id)?.status === "done";
          if (!wasDone) incrementVideosMultiplied();
          setQueue((prev) =>
            prev.map((q) =>
              q.id === pending.id
                ? {
                    ...q,
                    status: "done" as const,
                    progress: undefined,
                    shortOutputFile: shortOutputFileStored,
                    shortJobId: shortJobIdStored,
                    shortEditorialSummary,
                    shortEditorialSkip,
                    shortEditorialCuts,
                  }
                : q
            )
          );
          queueRef.current = queueRef.current.map((q) =>
            q.id === pending.id
              ? {
                  ...q,
                  status: "done" as const,
                  progress: undefined,
                  shortOutputFile: shortOutputFileStored,
                  shortJobId: shortJobIdStored,
                  shortEditorialSummary,
                  shortEditorialSkip,
                  shortEditorialCuts,
                }
              : q
          );
          setQueueResults((qr) => {
            const next = { ...qr, [pending.id]: snap };
            queueResultsRef.current = next;
            return next;
          });
          if (activeQueueIdRef.current === pending.id) {
            applySnapshot(snap);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          setQueue((prev) =>
            prev.map((q) =>
              q.id === pending.id
                ? {
                    ...q,
                    status: "error" as const,
                    error: msg,
                    progress: undefined,
                  }
                : q
            )
          );
          queueRef.current = queueRef.current.map((q) =>
            q.id === pending.id
              ? {
                  ...q,
                  status: "error" as const,
                  error: msg,
                  progress: undefined,
                }
              : q
          );
          if (activeQueueIdRef.current === pending.id) {
            setError(msg);
          }
        } finally {
          // Restore whichever notes were active before this queue item ran.
          if (typeof pending.aiInstructions === "string") {
            setCarouselFocusToStorage(prevCarouselNotes);
          }
          const stillPending = queueRef.current.some(
            (q) => q.status === "pending"
          );
          if (!stillPending) {
            setLoading(false);
          }
        }
      }
    } finally {
      processingQueueRef.current = false;
      setLoading(false);
      // If another upload called processQueueLoop while this run held the lock, drain pending now.
      queueMicrotask(() => {
        if (
          queueRef.current.some((q) => q.status === "pending") &&
          !processingQueueRef.current
        ) {
          void processQueueLoop();
        }
      });
    }
  }, [applySnapshot]);

  const enqueueFiles = useCallback(
    (
      files: File[],
      opts?: { aiInstructionsByIndex?: Array<string | undefined> }
    ) => {
      const list = files.filter(isLikelyVideoFile);
      if (list.length === 0) {
        if (files.length > 0) {
          setError(
            "None of the selected files look like supported videos (e.g. .mp4, .mov, .webm). If this is a video, try renaming with a standard extension or export as MP4."
          );
        }
        return;
      }
      const o = studioOutputsRef.current;
      if (!o.carousel && !o.imagePost && !o.xPost && !o.reelShort) {
        setError("Choose at least one output format before uploading.");
        return;
      }
      setError(null);
      const notesByIndex = opts?.aiInstructionsByIndex ?? [];
      const newItems: VideoQueueItem[] = list.map((f, idx) => ({
        id: crypto.randomUUID(),
        file: f,
        aiInstructions:
          typeof notesByIndex[idx] === "string"
            ? notesByIndex[idx]!.trim().slice(0, MAX_CAROUSEL_FOCUS_CHARS)
            : undefined,
        status: "pending" as const,
      }));
      // Update ref synchronously before processQueueLoop  -  React may apply
      // setQueue after the file input handler returns, so the loop would see an empty queue.
      const next = [...queueRef.current, ...newItems];
      queueRef.current = next;
      setQueue(next);
      // Always focus the new upload so the UI does not stay on a previous queue item
      // (prev ?? newId kept the old selection and felt like "nothing happened").
      selectQueueItem(newItems[0]!.id);
      void processQueueLoop();
    },
    [processQueueLoop, selectQueueItem, setError]
  );

  const file = useMemo(() => {
    if (!activeQueueId) return null;
    return queue.find((q) => q.id === activeQueueId)?.file ?? null;
  }, [queue, activeQueueId]);

  const shortOutputFile = useMemo(() => {
    if (!activeQueueId) return null;
    return (
      queue.find((q) => q.id === activeQueueId)?.shortOutputFile ?? null
    );
  }, [queue, activeQueueId]);

  const shortJobId = useMemo(() => {
    if (!activeQueueId) return null;
    const id = queue.find((q) => q.id === activeQueueId)?.shortJobId;
    return typeof id === "string" && id.length > 0 ? id : null;
  }, [queue, activeQueueId]);

  const shortEditorialSummary = useMemo(() => {
    if (!activeQueueId) return null;
    const v = queue.find((q) => q.id === activeQueueId)?.shortEditorialSummary;
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  }, [queue, activeQueueId]);

  const shortEditorialSkip = useMemo(() => {
    if (!activeQueueId) return null;
    const v = queue.find((q) => q.id === activeQueueId)?.shortEditorialSkip;
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  }, [queue, activeQueueId]);

  const shortEditorialCuts = useMemo(() => {
    if (!activeQueueId) return null;
    return (
      queue.find((q) => q.id === activeQueueId)?.shortEditorialCuts ?? null
    );
  }, [queue, activeQueueId]);

  const shortEditorialHydratedRef = useRef<Set<string>>(new Set());

  // Completed jobs store editorial on `meta`; older studio builds missed it at poll time.
  useEffect(() => {
    const aid = activeQueueId;
    const jobId = shortJobId;
    if (!aid || !jobId) return;
    if (shortEditorialHydratedRef.current.has(jobId)) return;

    const row = queueRef.current.find((q) => q.id === aid);
    if (!row || row.status !== "done") return;

    const hasStored =
      (typeof row.shortEditorialSummary === "string" &&
        row.shortEditorialSummary.trim()) ||
      (typeof row.shortEditorialSkip === "string" &&
        row.shortEditorialSkip.trim()) ||
      (row.shortEditorialCuts !== undefined && row.shortEditorialCuts !== null);
    if (hasStored) {
      shortEditorialHydratedRef.current.add(jobId);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const state = await fetchJobPollState(jobId);
        if (cancelled || state.status !== "completed") return;
        const fields = editorialFieldsFromJobPoll(state);
        const hasAny =
          Boolean(fields.editorialSummary) ||
          Boolean(fields.editorialSkip) ||
          (fields.editorialCuts !== undefined && fields.editorialCuts !== null);
        shortEditorialHydratedRef.current.add(jobId);
        if (!hasAny) return;
        setQueue((prev) =>
          prev.map((q) =>
            q.id === aid
              ? {
                  ...q,
                  shortEditorialSummary: fields.editorialSummary,
                  shortEditorialSkip: fields.editorialSkip,
                  shortEditorialCuts: fields.editorialCuts,
                }
              : q
          )
        );
        queueRef.current = queueRef.current.map((q) =>
          q.id === aid
            ? {
                ...q,
                shortEditorialSummary: fields.editorialSummary,
                shortEditorialSkip: fields.editorialSkip,
                shortEditorialCuts: fields.editorialCuts,
              }
            : q
        );
      } catch {
        shortEditorialHydratedRef.current.add(jobId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeQueueId, shortJobId]);

  const reprocessActiveShortOutput = useCallback(
    async (text: StudioShortTextOptions) => {
      const aid = activeQueueIdRef.current;
      if (!aid) {
        setError("No active video.");
        return;
      }
      if (shortReprocessInFlightRef.current) {
        return;
      }
      const row = queueRef.current.find((q) => q.id === aid);
      if (!row?.shortJobId) {
        setError(
          "Short re-process needs a job from this session. Re-upload the video to enable editing."
        );
        return;
      }
      shortReprocessInFlightRef.current = true;
      setShortReprocessBusy(true);
      setError(null);
      try {
        const shortRun = await reprocessVideoToShortJob(
          row.shortJobId,
          text,
          getShortOutputFileName(row.file.name)
        );
        setQueue((prev) =>
          prev.map((q) =>
            q.id === aid
              ? {
                  ...q,
                  shortOutputFile: shortRun.outputFile,
                  shortEditorialSummary: shortRun.editorialSummary ?? null,
                  shortEditorialSkip: shortRun.editorialSkip ?? null,
                  shortEditorialCuts: shortRun.editorialCuts ?? null,
                }
              : q
          )
        );
        queueRef.current = queueRef.current.map((q) =>
          q.id === aid
            ? {
                ...q,
                shortOutputFile: shortRun.outputFile,
                shortEditorialSummary: shortRun.editorialSummary ?? null,
                shortEditorialSkip: shortRun.editorialSkip ?? null,
                shortEditorialCuts: shortRun.editorialCuts ?? null,
              }
            : q
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Short re-process failed."
        );
      } finally {
        shortReprocessInFlightRef.current = false;
        setShortReprocessBusy(false);
      }
    },
    []
  );

  const generateCarousel = useCallback(
    async (options?: { defaultsOnly?: boolean }) => {
      const defaultsOnly = options?.defaultsOnly === true;
      setError(null);
      setZipBase64(null);
      setFirstSlidePreviewBase64(null);
      setSlidePreviewBase64s(null);
      setSlidePreviewBase64sInstagram(null);
      setSocialCaption("");
      setImagePost(null);
      setImagePostError(null);
      setSocialMicro(null);
      setSocialMicroError(null);

      const aid = activeQueueIdRef.current;
      const videoFile =
        (aid ? queueRef.current.find((q) => q.id === aid)?.file : null) ??
        null;
      if (!videoFile || !aid) {
        setError("Choose a video file.");
        return;
      }

      const out = studioOutputsRef.current;
      if (!out.carousel && !out.imagePost && !out.xPost) {
        setError(
          "Enable at least one of Carousel, Image post, or X/Threads to regenerate."
        );
        return;
      }

      const layout = defaultsOnly ? PROCESS_DEFAULTS.layoutId : layoutId;
      const carousel = defaultsOnly
        ? PROCESS_DEFAULTS.carouselOverride
        : carouselOverride;
      const bgSource = defaultsOnly
        ? PROCESS_DEFAULTS.backgroundSource
        : backgroundSource;

      const bgFile =
        bgSource === "own_background"
          ? backgroundFile ?? backgroundInputRef.current?.files?.[0] ?? null
          : null;
      if (bgSource === "own_background" && !backgroundFile && bgFile) {
        setBackgroundFile(bgFile);
      }

      setLoading(true);
      setProcessTiming(null);
      try {
        const canReuseTranscript =
          !defaultsOnly && transcript.length > 0;
        const snap = await postCarouselAndImagePost(
          videoFile,
          {
            layoutId: layout,
            carouselOverride: carousel,
            backgroundSource: bgSource,
            backgroundFile:
              bgSource === "own_background"
                ? backgroundFile ?? bgFile
                : null,
            frameColorAdjust,
            reuseTranscription: canReuseTranscript,
            existingTranscript: canReuseTranscript ? transcript : undefined,
            outputs: {
              carousel: out.carousel,
              imagePost: out.imagePost,
              social: out.xPost,
            },
          },
          backgroundInputRef
        );
        applySnapshot(snap);
        setQueueResults((qr) => {
          const next = { ...qr, [aid]: snap };
          queueResultsRef.current = next;
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [
      applySnapshot,
      backgroundFile,
      backgroundSource,
      layoutId,
      carouselOverride,
      transcript,
      frameColorAdjust,
    ]
  );

  const updateSlide = useCallback(
    (index: number, field: "headline" | "body", value: string) => {
      setEditableSlides((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = [...prev];
        const row = { ...next[index] };
        if (field === "headline") row.headline = value;
        else row.body = value;
        next[index] = row;
        return next;
      });
    },
    []
  );

  const removeSlide = useCallback((index: number) => {
    setEditableSlides((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev
        .filter((_, i) => i !== index)
        .map((s, i) => ({ ...s, order: i + 1 }));
      carouselTextBaselineForLearningRef.current =
        cloneSlidesForLearningBaseline(next);
      return next;
    });
    setSlidePreviewBase64s((prev) => {
      if (!prev || index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      if (index === 0) {
        setFirstSlidePreviewBase64(next.length > 0 ? next[0] : null);
      }
      return next.length > 0 ? next : null;
    });
    setSlidePreviewBase64sInstagram((prev) => {
      if (!prev || index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : null;
    });
  }, []);

  const addSlide = useCallback(() => {
    setEditableSlides((prev) => {
      const nextOrder = prev.length + 1;
      const row: ApiSlide = {
        order: nextOrder,
        headline: "",
        body: "",
        evidenceSegmentIds: [],
      };
      const next = [...prev, row];
      carouselTextBaselineForLearningRef.current =
        cloneSlidesForLearningBaseline(next);
      return next;
    });
  }, []);

  const reRenderZip = useCallback(async () => {
    setError(null);
    const aid = activeQueueIdRef.current;
    const videoFile =
      (aid ? queueRef.current.find((q) => q.id === aid)?.file : null) ?? null;
    const slidesForRender = editableSlidesRef.current;
    if (!videoFile || slidesForRender.length === 0) {
      setError("Need a video file and slides to re-render.");
      return;
    }
    const bgFile =
      backgroundSource === "own_background"
        ? backgroundFile ?? backgroundInputRef.current?.files?.[0] ?? null
        : null;
    if (backgroundSource === "own_background" && !backgroundFile && bgFile) {
      setBackgroundFile(bgFile);
    }
    setReRenderLoading(true);
    try {
      const fd = new FormData();
      fd.append("video", videoFile);
      if (backgroundSource === "own_background" && bgFile) {
        fd.append("background", bgFile);
      }
      fd.append("slides", JSON.stringify(slidesForRender));
      fd.append("transcript", JSON.stringify(transcript));
      fd.append("layoutId", layoutId);
      fd.append("brandingId", DEFAULT_BRANDING_ID);
      appendVisualReferenceFormFields(fd);
      fd.append(
        "frameColorAdjust",
        JSON.stringify(frameColorAdjustRef.current)
      );
      const res = await fetch(clientApiPath("/api/render"), {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        setError(
          res.ok
            ? "Invalid response from server."
            : `Re-render failed (${res.status}).`
        );
        return;
      }
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Re-render failed"
        );
        return;
      }
      const learnLines = buildCarouselLearningLines(
        carouselTextBaselineForLearningRef.current,
        slidesForRender
      );
      if (learnLines.length > 0) {
        appendLearnedFromEditsLines(learnLines);
      }
      carouselTextBaselineForLearningRef.current =
        cloneSlidesForLearningBaseline(slidesForRender);
      const newZip =
        typeof data.zipBase64 === "string" ? data.zipBase64 : null;
      const newFirst =
        typeof data.firstSlidePreviewBase64 === "string"
          ? data.firstSlidePreviewBase64
          : null;
      setZipBase64(newZip);
      setFirstSlidePreviewBase64(newFirst);
      let nextPreviews: string[] | null = null;
      let nextPreviewsIg: string[] | null = null;
      if (newZip) {
        try {
          const { youtube, instagram } =
            await extractCarouselSlidePreviewsFromZipSafe(newZip);
          nextPreviews =
            youtube.length > 0 ? youtube : newFirst ? [newFirst] : null;
          nextPreviewsIg = instagram.length > 0 ? instagram : null;
        } catch {
          nextPreviews = newFirst ? [newFirst] : null;
          nextPreviewsIg = null;
        }
      } else {
        nextPreviews = newFirst ? [newFirst] : null;
        nextPreviewsIg = null;
      }
      setSlidePreviewBase64s(nextPreviews);
      setSlidePreviewBase64sInstagram(nextPreviewsIg);

      if (aid) {
        setQueueResults((qr) => {
          const prevSnap = qr[aid] ?? buildSnapshotFromWorkspace();
          const merged: QueueCarouselSnapshot = {
            ...prevSnap,
            zipBase64: newZip,
            firstSlidePreviewBase64: newFirst,
            slidePreviewBase64s: nextPreviews,
            slidePreviewBase64sInstagram: nextPreviewsIg,
            editableSlides: slidesForRender,
            transcript,
            socialCaption,
            layoutId,
            carouselOverride,
            backgroundSource,
            backgroundFile:
              backgroundSource === "own_background" ? backgroundFile : null,
            imagePost: prevSnap.imagePost ?? null,
            imagePostError: prevSnap.imagePostError ?? null,
            socialMicro: prevSnap.socialMicro ?? null,
            socialMicroError: prevSnap.socialMicroError ?? null,
            processTiming: prevSnap.processTiming ?? null,
            frameColorAdjust: frameColorAdjustRef.current,
          };
          const next = { ...qr, [aid]: merged };
          queueResultsRef.current = next;
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setReRenderLoading(false);
    }
  }, [
    transcript,
    socialCaption,
    layoutId,
    backgroundFile,
    backgroundSource,
    buildSnapshotFromWorkspace,
    frameColorAdjust,
  ]);

  const downloadZip = useCallback(() => {
    if (!zipBase64) return;
    let bin: string;
    try {
      bin = atob(zipBase64);
    } catch {
      setError("Download data was corrupted. Try generating again.");
      return;
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file?.name
      ? carouselZipFilename(file.name)
      : "carousel.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [zipBase64, file]);

  const canDownloadAllZips = useMemo(
    () => queue.filter((q) => q.status === "done").length >= 2,
    [queue]
  );

  const downloadAllZips = useCallback(async () => {
    setError(null);
    const merged: Record<string, QueueCarouselSnapshot> = {
      ...queueResultsRef.current,
    };
    const aid = activeQueueIdRef.current;
    if (aid) {
      merged[aid] = buildSnapshotFromWorkspace();
    }
    const doneItems = queueRef.current.filter((q) => q.status === "done");
    const files: { name: string; base64: string }[] = [];
    const usedNames = new Set<string>();
    for (const q of doneItems) {
      const z = merged[q.id]?.zipBase64;
      if (typeof z !== "string" || z.length === 0) continue;
      let name = carouselZipFilename(q.file.name);
      if (usedNames.has(name)) {
        const stem = name.replace(/\.zip$/i, "");
        let n = 2;
        while (usedNames.has(`${stem}_${n}.zip`)) n += 1;
        name = `${stem}_${n}.zip`;
      }
      usedNames.add(name);
      files.push({ name, base64: z });
    }
    if (files.length === 0) {
      setError("No completed carousel zips to download yet.");
      return;
    }
    setDownloadAllZipsLoading(true);
    try {
      const base64ToBlob = (b64: string): Blob | null => {
        let bin: string;
        try {
          bin = atob(b64);
        } catch {
          return null;
        }
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: "application/zip" });
      };
      if (files.length === 1) {
        const blob = base64ToBlob(files[0].base64);
        if (!blob) {
          setError("Download data was corrupted. Try generating again.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = files[0].name;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const { default: JSZip } = await import("jszip");
      const root = new JSZip();
      for (const f of files) {
        const blob = base64ToBlob(f.base64);
        if (!blob) {
          setError(`Could not read zip data for ${f.name}.`);
          return;
        }
        const buf = await blob.arrayBuffer();
        root.file(f.name, buf);
      }
      const outBlob = await root.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "carousels_export.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadAllZipsLoading(false);
    }
  }, [buildSnapshotFromWorkspace]);

  const downloadImagePostPng = useCallback(() => {
    if (!imagePost?.imageBase64) return;
    let bin: string;
    try {
      bin = atob(imagePost.imageBase64);
    } catch {
      setError("Image data was corrupted. Try generating again.");
      return;
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stem = file?.name.replace(/\.[^/.]+$/i, "").trim() || "image_post";
    a.download = `${stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}_post.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [file, imagePost]);

  const patchImagePost = useCallback((patch: Partial<ImagePostSnapshot>) => {
    setImagePost((prev) => (!prev ? prev : { ...prev, ...patch }));
  }, []);

  const regenerateImagePostCopy = useCallback(async () => {
    const aid = activeQueueIdRef.current;
    const videoFile =
      (aid ? queueRef.current.find((q) => q.id === aid)?.file : null) ?? null;
    if (!videoFile || transcript.length === 0) {
      setError("Need a video and transcript to regenerate image post copy.");
      return;
    }
    setError(null);
    setImagePostBusy(true);
    try {
      const prevPlan = imagePost
        ? {
            hook: imagePost.hook,
            microCta: imagePost.microCta,
            caption: imagePost.caption,
            altText: imagePost.altText,
          }
        : undefined;
      const ip = await postImagePostFromVideo(videoFile, transcript, {
        previousPlan: prevPlan,
        frameColorAdjust,
      });
      setImagePost(ip);
      setImagePostError(null);
      if (aid) {
        setQueueResults((qr) => {
          const cur = qr[aid];
          if (!cur) return qr;
          return {
            ...qr,
            [aid]: {
              ...cur,
              frameColorAdjust,
              imagePost: ip,
              imagePostError: null,
            },
          };
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Regenerate failed";
      setImagePostError(msg);
      setError(msg);
    } finally {
      setImagePostBusy(false);
    }
  }, [transcript, imagePost, frameColorAdjust]);

  const regenerateSocialMicro = useCallback(async () => {
    const aid = activeQueueIdRef.current;
    if (transcript.length === 0) {
      setError("Need a transcript to regenerate X / Threads copy.");
      return;
    }
    setError(null);
    setSocialMicroBusy(true);
    try {
      const plan = await postSocialMicroFromTranscript(transcript);
      setSocialMicro(plan);
      setSocialMicroError(null);
      if (aid) {
        setQueueResults((qr) => {
          const cur = qr[aid];
          if (!cur) return qr;
          return {
            ...qr,
            [aid]: { ...cur, socialMicro: plan, socialMicroError: null },
          };
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Regenerate failed";
      setSocialMicroError(msg);
      setError(msg);
    } finally {
      setSocialMicroBusy(false);
    }
  }, [transcript]);

  const rerenderImagePostOverlay = useCallback(
    async (hook: string, microCta: string): Promise<boolean> => {
      const aid = activeQueueIdRef.current;
      const videoFile =
        (aid ? queueRef.current.find((q) => q.id === aid)?.file : null) ?? null;
      const frameTime = imagePostFrameTimeRef.current;
      if (
        !videoFile ||
        frameTime === undefined ||
        !Number.isFinite(frameTime)
      ) {
        setError("Need the video file and frame time to update the image.");
        return false;
      }
      setImagePostBusy(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("video", videoFile);
        fd.append("frameTimeSec", String(frameTime));
        fd.append("hook", hook);
        fd.append("microCta", microCta);
        appendVisualReferenceFormFields(fd);
        fd.append(
          "frameColorAdjust",
          JSON.stringify(frameColorAdjustRef.current)
        );
        const res = await fetch(clientApiPath("/api/image-post/render-post"), {
          method: "POST",
          body: fd,
        });
        const data = await parseResponseJson<{
          imageBase64?: string;
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(data.error ?? "Could not update image");
        }
        const b64 = data.imageBase64;
        if (!b64) throw new Error("Missing image in response");
        setImagePost((prev) => {
          if (!prev) return prev;
          return { ...prev, hook, microCta, imageBase64: b64 };
        });
        if (aid) {
          setQueueResults((qr) => {
            const cur = qr[aid];
            if (!cur?.imagePost) return qr;
            return {
              ...qr,
              [aid]: {
                ...cur,
                frameColorAdjust: frameColorAdjustRef.current,
                imagePost: {
                  ...cur.imagePost,
                  hook,
                  microCta,
                  imageBase64: b64,
                },
              },
            };
          });
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update image");
        return false;
      } finally {
        setImagePostBusy(false);
      }
    },
    []
  );

  const applyImagePostFrameColor = useCallback(async (): Promise<boolean> => {
    const aid = activeQueueIdRef.current;
    const videoFile =
      (aid ? queueRef.current.find((q) => q.id === aid)?.file : null) ?? null;
    const ip = imagePost;
    const frameTime = ip?.frameTimeSec;
    if (!videoFile || !ip || frameTime === undefined || !Number.isFinite(frameTime)) {
      setError("Need the video file and image post to apply frame color.");
      return false;
    }
    setImagePostBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("video", videoFile);
      fd.append("frameTimeSec", String(frameTime));
      fd.append("hook", ip.hook);
      fd.append("microCta", ip.microCta);
      appendVisualReferenceFormFields(fd);
      fd.append(
        "frameColorAdjust",
        JSON.stringify(frameColorAdjustRef.current)
      );
      const res = await fetch(clientApiPath("/api/image-post/render-post"), {
        method: "POST",
        body: fd,
      });
      const data = await parseResponseJson<{
        imageBase64?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error ?? "Could not update image");
      }
      const b64 = data.imageBase64;
      if (!b64) throw new Error("Missing image in response");
      setImagePost((prev) => (!prev ? prev : { ...prev, imageBase64: b64 }));
      if (aid) {
        setQueueResults((qr) => {
          const cur = qr[aid];
          if (!cur?.imagePost) return qr;
          return {
            ...qr,
            [aid]: {
              ...cur,
              frameColorAdjust: frameColorAdjustRef.current,
              imagePost: { ...cur.imagePost, imageBase64: b64 },
            },
          };
        });
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update image");
      return false;
    } finally {
      setImagePostBusy(false);
    }
  }, [imagePost]);

  const value = useMemo<CarouselWorkspaceValue>(
    () => ({
      queue,
      activeQueueId,
      selectQueueItem,
      enqueueFiles,
      file,
      shortOutputFile,
      shortJobId,
      shortEditorialSummary,
      shortEditorialSkip,
      shortEditorialCuts,
      shortReprocessBusy,
      reprocessActiveShortOutput,
      layoutId,
      setLayoutId,
      carouselOverride,
      setCarouselOverride,
      loading,
      error,
      setError,
      recommendation,
      effectiveType,
      editableSlides,
      transcript,
      durationSec,
      zipBase64,
      firstSlidePreviewBase64,
      slidePreviewBase64s,
      slidePreviewBase64sInstagram,
      socialCaption,
      setSocialCaption,
      reRenderLoading,
      backgroundSource,
      setBackgroundSource,
      backgroundFile,
      setBackgroundFile,
      fileInputRef,
      backgroundInputRef,
      generateCarousel,
      updateSlide,
      removeSlide,
      addSlide,
      reRenderZip,
      downloadZip,
      downloadAllZips,
      downloadAllZipsLoading,
      canDownloadAllZips,
      clearWorkspaceForNewVideo,
      imagePost,
      imagePostError,
      imagePostBusy,
      patchImagePost,
      downloadImagePostPng,
      regenerateImagePostCopy,
      rerenderImagePostOverlay,
      applyImagePostFrameColor,
      frameColorAdjust,
      setFrameColorAdjust,
      socialMicro,
      socialMicroError,
      socialMicroBusy,
      regenerateSocialMicro,
      queueSnapshots: queueResults,
      flushActiveQueueSnapshot,
      processTiming,
      studioOutputs,
      setStudioOutputs,
    }),
    [
      queue,
      queueResults,
      activeQueueId,
      selectQueueItem,
      enqueueFiles,
      file,
      shortOutputFile,
      shortJobId,
      shortEditorialSummary,
      shortEditorialSkip,
      shortEditorialCuts,
      shortReprocessBusy,
      reprocessActiveShortOutput,
      layoutId,
      carouselOverride,
      loading,
      error,
      recommendation,
      effectiveType,
      editableSlides,
      transcript,
      durationSec,
      zipBase64,
      firstSlidePreviewBase64,
      slidePreviewBase64s,
      slidePreviewBase64sInstagram,
      socialCaption,
      setSocialCaption,
      reRenderLoading,
      downloadAllZipsLoading,
      canDownloadAllZips,
      backgroundSource,
      backgroundFile,
      generateCarousel,
      updateSlide,
      removeSlide,
      addSlide,
      reRenderZip,
      downloadZip,
      downloadAllZips,
      clearWorkspaceForNewVideo,
      imagePost,
      imagePostError,
      imagePostBusy,
      patchImagePost,
      downloadImagePostPng,
      regenerateImagePostCopy,
      rerenderImagePostOverlay,
      applyImagePostFrameColor,
      frameColorAdjust,
      socialMicro,
      socialMicroError,
      socialMicroBusy,
      regenerateSocialMicro,
      flushActiveQueueSnapshot,
      processTiming,
      studioOutputs,
      setStudioOutputs,
    ]
  );

  return (
    <CarouselWorkspaceContext.Provider value={value}>
      {children}
    </CarouselWorkspaceContext.Provider>
  );
}

export function useCarouselWorkspace(): CarouselWorkspaceValue {
  const ctx = useContext(CarouselWorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useCarouselWorkspace must be used within CarouselWorkspaceProvider"
    );
  }
  return ctx;
}
