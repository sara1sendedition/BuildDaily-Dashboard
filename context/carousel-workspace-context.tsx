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
  X_THREADS_OUTPUT_ENABLED,
  withEffectiveStudioOutputs,
} from "@/lib/studio-output-flags";
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
import { isMobileClient, useMobileProcessingWakeLock } from "@/lib/mobile-client";
import {
  appendCarouselVideoIngestFields,
  hasCarouselVideoSource,
  storedSourceVideoUrl,
  type CarouselVideoIngestOpts,
} from "@/lib/carousel-video-source";
import {
  appendLearnedFromEditsLines,
  buildCarouselLearningLines,
  cloneSlidesForLearningBaseline,
  getLearnedFromEditsBlob,
  mergeCopyContextWithLearnings,
} from "@/lib/learned-from-edits";
import { appendVisualReferenceFormFields } from "@/lib/visual-reference-storage";
import { studioContentFingerprint } from "@/lib/multiplier/output-delivery-status";
import { clientApiPath } from "@/lib/client-api-path";
import {
  uploadFileToBunnyStorage,
  uploadImageToBunnyStorage,
  uploadSlidesToBunnyStorage,
  type BunnyAssetUrls,
} from "@/lib/storage/bunny-upload-client";
import {
  buildPreviewRehydratePatchFromBunny,
  filterPreviewRehydratePatch,
  snapshotNeedsPreviewRehydrate,
  type PreviewRehydratePatch,
} from "@/lib/storage/bunny-fetch-client";
import {
  deleteMultiplierQueueItemFromHub,
  listMultiplierQueueFromHub,
  patchMultiplierQueueItemOnHub,
  upsertMultiplierQueueItemToHub,
  type HubMultiplierQueueItem,
  type MultiplierQueueKind,
  type MultiplierQueuePayload,
  type ImagePostCopyPayload,
} from "@/lib/multiplier-queue/hub-client";
import {
  createMultiplierProcessingJob,
  kickMultiplierProcessingDue,
} from "@/lib/multiplier-queue/processing-jobs-client";
import {
  failedOutputSummary,
  localQueueStatusFromHub,
  type MultiplierOutputKey,
  type MultiplierOutputsState,
} from "@/lib/multiplier-queue/output-state";
import { queueItemScheduleLabel } from "@/lib/queue-display-label";
import { sanitizeQueueErrorMessage } from "@/lib/multiplier-queue/merge-hub-payload";
import { parseResponseJson } from "@/lib/parse-response-json";
import { normalizeTranscriptSegments } from "@/lib/parse-reuse-transcript-json";
import {
  downloadCompletedShortFile,
  clearInFlightShortJob,
  editorialFieldsFromJobPoll,
  fetchJobPollState,
  getShortOutputFileName,
  pollVideoToShortJobUntilFile,
  readInFlightShortJob,
  recoverInFlightShortJob,
  reprocessVideoToShortJob,
  type InFlightShortJob,
  runVideoToShortIfEnabled,
  createShortJobFromDrive,
  resumeShortJobOutput,
  type StudioShortTextOptions,
} from "@/lib/run-video-to-short";
import { pickOutputRevisionFromJobPoll } from "@/lib/short-job-poll-meta";
import { isLikelyVideoFile } from "@/lib/is-likely-video-file";
import { incrementVideosMultiplied } from "@/lib/hub/metrics-store";
import {
  DEFAULT_FRAME_COLOR_ADJUST,
  clampFrameColorAdjust,
  type FrameColorAdjust,
} from "@/lib/frame-color-adjust";

const DEFAULT_BRANDING_ID = "default";

/** Thrown when a queue row is removed while its pipeline is still running. */
class QueueItemRemovedError extends Error {
  constructor() {
    super("Queue item removed");
    this.name = "QueueItemRemovedError";
  }
}

function isQueueProcessingAbort(e: unknown): boolean {
  return (
    e instanceof QueueItemRemovedError ||
    (e instanceof DOMException && e.name === "AbortError")
  );
}

/** Only auto-resume server-side Short jobs that were interrupted, not hard failures. */
function shouldAutoResumeShort(
  q: VideoQueueItem,
  giveUp: ReadonlySet<string>,
  hasBunnyReel?: boolean,
): boolean {
  if (giveUp.has(q.id)) return false;
  if (q.status !== "done" || !q.shortJobId?.trim()) return false;
  if (hasUsableShortOutput(q)) return false;
  // Preview can use Bunny directly; don't hammer expired Short-job downloads.
  if (hasBunnyReel) return false;
  if (!q.shortError) return true;
  const err = q.shortError.toLowerCase();
  if (
    err.includes("skipped") ||
    err.includes("create failed") ||
    err.includes("timed out after") ||
    err.includes("invalid response")
  ) {
    return false;
  }
  if (err.includes("download failed")) return true;
  if (err.includes("no reel mp4")) return true;
  if (hasShortEditorialMetadata(q)) {
    return !isTerminalShortResumeError(q.shortError);
  }
  return (
    err.includes("still processing") ||
    err.includes("lost connection") ||
    err.includes("still ") ||
    err.includes("load it automatically")
  );
}

function isTerminalShortResumeError(message: string): boolean {
  const err = message.toLowerCase();
  return (
    err.includes("skipped") ||
    err.includes("create failed") ||
    err.includes("timed out after") ||
    err.includes("invalid response") ||
    err.includes("job failed")
  );
}

/** True when the queue row already has a processed Short MP4, not the original upload. */
function hasUsableShortOutput(q: VideoQueueItem): boolean {
  if (!q.shortOutputFile || q.shortOutputFile.size === 0) {
    return false;
  }
  const expected = getShortOutputFileName(q.file.name || "video.mp4");
  return q.shortOutputFile.name === expected;
}

function hasShortEditorialMetadata(q: VideoQueueItem): boolean {
  return (
    (typeof q.shortEditorialSummary === "string" &&
      q.shortEditorialSummary.trim().length > 0) ||
    (typeof q.shortEditorialSkip === "string" &&
      q.shortEditorialSkip.trim().length > 0) ||
    (q.shortEditorialCuts !== undefined && q.shortEditorialCuts !== null)
  );
}

function queueItemMatchesSourceName(
  q: VideoQueueItem,
  sourceName: string
): boolean {
  return (
    q.file.name === sourceName || queueItemScheduleLabel(q) === sourceName
  );
}

export type { FrameColorAdjust };

/** Dynamic import keeps JSZip out of the main client chunk and avoids webpack HMR/module factory issues. */
async function extractCarouselSlidePreviewsFromZipSafe(zipBase64: string) {
  const { extractCarouselSlidePreviewsFromZip } = await import(
    "@/lib/zip-slide-previews"
  );
  return extractCarouselSlidePreviewsFromZip(zipBase64);
}

function moveArrayItem<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= arr.length ||
    toIndex >= arr.length
  ) {
    return arr;
  }
  const next = [...arr];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
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
  xPost: X_THREADS_OUTPUT_ENABLED,
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
  /**
   * Google Drive inbox file id for server-side ingest. When set, `file` is a
   * zero-byte placeholder (name/type only) and every processing call sends
   * this id instead of video bytes — the servers pull the video from Drive
   * directly. Avoids round-tripping large videos through the browser.
   */
  driveFileId?: string;
  /**
   * Video-to-Short stitch job id. When set, `file` is a zero-byte placeholder
   * and the Hub worker waits for stitch then downloads the MP4 — no browser
   * round-trip of the stitched file.
   */
  stitchJobId?: string;
  /** User-renamed title (queue + calendar); does not change the underlying file. */
  displayLabel?: string;
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
  /** Mirrors Video to Short `meta.output_revision` — busts stale Bunny previews after re-run. */
  shortOutputRevision?: number | null;
  /** Set when Reel was requested but failed or was skipped (carousel may still be done). */
  shortError?: string;
  /**
   * Fingerprint of studio copy/assets when processing first finished — used on
   * the calendar “Ready to schedule” list to show an Edited badge after changes.
   */
  studioContentBaseline?: string;
  /** Durable Hub ProcessingJob id when using server-side queue. */
  processingJobId?: string | null;
  /** True when this row is handled by the server worker (survives tab close). */
  durableProcessing?: boolean;
  /** Per-output process + ready-to-schedule state (from Hub payload). */
  outputs?: MultiplierOutputsState;
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
  /** Bunny.net URLs for slide PNGs / image-post JPEG, populated by the
   * post-process auto-upload effect in `ScheduleProvider`-adjacent code.
   * Persisted to Hub `ScheduleEntry.payload` at schedule time so publish
   * paths can pass URLs to Meta instead of base64. Phase 2.0.
   */
  bunnyUrls?: BunnyAssetUrls;
  /** Bumped on each slide PNG re-render so Bunny uploads use fresh object keys. */
  slidesAssetVersion?: number;
};

type CarouselWorkspaceValue = {
  queue: VideoQueueItem[];
  activeQueueId: string | null;
  selectQueueItem: (id: string) => void;
  removeQueueItem: (id: string) => void;
  renameQueueItem: (id: string, displayLabel: string) => void;
  enqueueFiles: (
    files: File[],
    opts?: {
      aiInstructionsByIndex?: Array<string | undefined>;
      /** Drive inbox ids for server-side ingest (parallel to `files`). */
      driveFileIdsByIndex?: Array<string | undefined>;
      /** Stitch job ids for server-side ingest (parallel to `files`). */
      stitchJobIdsByIndex?: Array<string | undefined>;
    }
  ) => string[];
  file: File | null;
  /** Short pipeline output for the active queue row, if any (not used for carousel/image). */
  shortOutputFile: File | null;
  /** Video to Short job id for the active row (re-process). */
  shortJobId: string | null;
  /** Editorial summary for the active row's Short pipeline run, if applicable. */
  shortEditorialSummary: string | null;
  shortEditorialSkip: string | null;
  shortEditorialCuts: unknown | null;
  shortError: string | null;
  /** Video to Short `meta.output_revision` for the active row (preview cache bust). */
  shortOutputRevision: number;
  reelMp4Url: string | null;
  /** True while a stored shortJobId is being polled/downloaded in the background. */
  shortResumeBusy: boolean;
  shortResumeMessage: string | null;
  /** Attach a recovered Short MP4 to the matching done queue row by source filename. */
  attachRecoveredShortFile: (sourceName: string, file: File) => void;
  recoverInFlightShortForQueue: (record: InFlightShortJob) => Promise<void>;
  shortReprocessBusy: boolean;
  /** Server progress while `reprocessActiveShortOutput` is in flight. */
  shortReprocessProgress: string | null;
  reprocessActiveShortOutput: (text: StudioShortTextOptions) => Promise<boolean>;
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
  /** Human-readable status while `reRenderZip` is in flight. */
  reRenderProgress: string | null;
  /** Last rebuild failure (shown near the Rebuild slide images control). */
  reRenderError: string | null;
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
  moveSlide: (fromIndex: number, toIndex: number) => void;
  /** True when slide copy can be baked into PNGs (local file, Drive ingest, or stored source URL). */
  canReRenderZip: boolean;
  /** True when image-post copy can be regenerated (needs transcript + video source). */
  canRegenerateImagePostCopy: boolean;
  /** True when hook/micro/color can be baked into the image-post PNG. */
  canRerenderImagePostOverlay: boolean;
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
  rerenderImagePostOverlay: (
    hook: string,
    microCta: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  /**
   * Phase 3.B — fetch a hydrated queue item's source video from Bunny and
   * replace its stub File with a real one. Returns the upgraded File on
   * success or `null` if no URL / fetch fails. UI callers should invoke
   * this before flows that need the raw video bytes.
   */
  rehydrateSourceVideoFile: (queueItemId: string) => Promise<File | null>;
  /** Mark a single Multiplier output ready (or not) for the Schedule page. */
  setOutputReadyToSchedule: (
    queueItemId: string,
    output: MultiplierOutputKey,
    ready: boolean,
  ) => Promise<void>;
  /** True after the first Hub queue list attempt finishes (ok, empty, or failed). */
  hubQueueHydrationDone: boolean;
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
    signal?: AbortSignal;
    /** Server-side ingest: send this Drive inbox id instead of video bytes. */
    driveFileId?: string;
    /** Server-side ingest: reuse this job's already-downloaded source video. */
    sourceJobId?: string;
    /** Stored Bunny URL when the browser only has a zero-byte placeholder File. */
    sourceVideoUrl?: string;
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
  appendCarouselVideoIngestFields(fd, videoFile, {
    driveFileId: opts.driveFileId,
    sourceJobId: opts.sourceJobId,
    sourceVideoUrl: opts.sourceVideoUrl,
  });
  if (bgSource === "own_background" && bgFile) {
    fd.append("background", bgFile);
  }
  fd.append("layoutId", opts.layoutId);
  fd.append("brandingId", DEFAULT_BRANDING_ID);
  if (opts.carouselOverride) fd.append("carouselType", opts.carouselOverride);
  const reuseTranscript = normalizeTranscriptSegments(opts.existingTranscript);
  if (opts.reuseTranscription && reuseTranscript) {
    fd.append("reuseTranscription", "1");
    fd.append("transcript", JSON.stringify(reuseTranscript));
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
  const sources = getReferenceSourcesFromStorage().trim();
  if (sources) {
    fd.append(
      "referenceSources",
      sources.slice(0, MAX_REFERENCE_SOURCES_CHARS)
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
    signal: opts.signal,
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
  const transcript = normalizeTranscriptSegments(tr) ?? [];
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
  transcript: QueueCarouselSnapshot["transcript"],
  signal?: AbortSignal
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
    signal,
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
    signal?: AbortSignal;
    /** Server-side ingest: send this Drive inbox id instead of video bytes. */
    driveFileId?: string;
    /** Server-side ingest: reuse this job's already-downloaded source video. */
    sourceJobId?: string;
    /** Stored Bunny URL when the browser only has a zero-byte placeholder File. */
    sourceVideoUrl?: string;
  }
): Promise<ImagePostSnapshot> {
  const fd = new FormData();
  appendCarouselVideoIngestFields(fd, videoFile, {
    driveFileId: options?.driveFileId,
    sourceJobId: options?.sourceJobId,
    sourceVideoUrl: options?.sourceVideoUrl,
  });
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
  const reuseTranscript = normalizeTranscriptSegments(transcript);
  if (reuseTranscript) {
    fd.append("reuseTranscription", "1");
    fd.append("transcript", JSON.stringify(reuseTranscript));
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
    signal: options?.signal,
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
    transcript:
      normalizeTranscriptSegments(data.transcript) ??
      normalizeTranscriptSegments(transcript) ??
      [],
    durationSec: typeof data.durationSec === "number" ? data.durationSec : 0,
    frameTimeSec: typeof data.frameTimeSec === "number" ? data.frameTimeSec : 0,
    imageBase64: data.imageBase64,
  };
}

async function postVideoTranscript(
  videoFile: File,
  signal?: AbortSignal,
  ingest?: CarouselVideoIngestOpts
): Promise<QueueCarouselSnapshot["transcript"]> {
  const fd = new FormData();
  appendCarouselVideoIngestFields(fd, videoFile, ingest ?? {});
  const res = await fetch(clientApiPath("/api/transcribe"), {
    method: "POST",
    body: fd,
    signal,
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
  const normalized = normalizeTranscriptSegments(tr);
  if (!normalized) {
    throw new Error("Transcription returned no segments.");
  }
  return normalized;
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
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
    /** One video upload at a time (phones — avoids parallel multipart stalls). */
    serializeUploads?: boolean;
  },
  backgroundInputRef: RefObject<HTMLInputElement | null>
): Promise<QueueCarouselSnapshot> {
  const clientT0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const outputs: StudioParallelOutputs = opts.outputs ?? {
    carousel: true,
    imagePost: true,
    social: X_THREADS_OUTPUT_ENABLED,
  };

  const normalizedExisting = normalizeTranscriptSegments(opts.existingTranscript);
  const reuse =
    opts.reuseTranscription === true && normalizedExisting !== null;

  const sharedTranscript: QueueCarouselSnapshot["transcript"] = reuse
    ? normalizedExisting!
    : await postVideoTranscript(videoFile, opts.signal, {
        driveFileId: opts.driveFileId,
        sourceJobId: opts.sourceJobId,
        sourceVideoUrl: opts.sourceVideoUrl,
      });

  const parallelOpts = {
    ...opts,
    reuseTranscription: true,
    existingTranscript: sharedTranscript,
  };

  const onProgress = opts.onProgress;
  const parallelLabels: string[] = [];
  if (outputs.carousel) parallelLabels.push("carousel");
  if (outputs.imagePost) parallelLabels.push("image post");
  if (outputs.social) parallelLabels.push("X/Threads");
  const doneLabels = new Set<string>();
  const reportParallelProgress = () => {
    if (!onProgress || parallelLabels.length === 0) return;
    const remaining = parallelLabels.filter((l) => !doneLabels.has(l));
    onProgress(
      remaining.length > 0
        ? `Generating ${remaining.join(", ")}…`
        : "Finishing…"
    );
  };

  reportParallelProgress();

  const serializeUploads = opts.serializeUploads ?? isMobileClient();
  if (serializeUploads) {
    let carousel: QueueCarouselSnapshot;
    if (outputs.carousel) {
      carousel = await postProcessAndBuildSnapshot(
        videoFile,
        parallelOpts,
        backgroundInputRef
      );
      doneLabels.add("carousel");
      reportParallelProgress();
    } else {
      carousel = buildSkippedCarouselSnapshot(sharedTranscript, {
        layoutId: parallelOpts.layoutId,
        carouselOverride: parallelOpts.carouselOverride,
        backgroundSource: parallelOpts.backgroundSource,
        backgroundFile: parallelOpts.backgroundFile,
        frameColorAdjust:
          parallelOpts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
      });
    }

    let imagePost: ImagePostSnapshot | null;
    let imagePostError: string | null;
    if (outputs.imagePost) {
      try {
        imagePost = await postImagePostFromVideo(videoFile, sharedTranscript, {
          frameColorAdjust:
            parallelOpts.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
          signal: opts.signal,
          driveFileId: opts.driveFileId,
          sourceJobId: opts.sourceJobId,
          sourceVideoUrl: opts.sourceVideoUrl,
        });
        imagePostError = null;
        doneLabels.add("image post");
        reportParallelProgress();
      } catch (reason) {
        imagePost = null;
        imagePostError =
          reason instanceof Error
            ? reason.message
            : "Could not generate image post.";
      }
    } else {
      imagePost = null;
      imagePostError = null;
    }

    let socialMicro: SocialMicroSnapshot | null;
    let socialMicroError: string | null;
    if (outputs.social) {
      try {
        socialMicro = await postSocialMicroFromTranscript(
          sharedTranscript,
          opts.signal
        );
        socialMicroError = null;
        doneLabels.add("X/Threads");
        reportParallelProgress();
      } catch (reason) {
        socialMicro = null;
        socialMicroError =
          reason instanceof Error
            ? reason.message
            : "Could not generate Twitter/Threads copy.";
      }
    } else {
      socialMicro = null;
      socialMicroError = null;
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

  const carouselP = outputs.carousel
    ? postProcessAndBuildSnapshot(videoFile, parallelOpts, backgroundInputRef).then(
        (snap) => {
          doneLabels.add("carousel");
          reportParallelProgress();
          return snap;
        }
      )
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
        signal: opts.signal,
        driveFileId: opts.driveFileId,
        sourceJobId: opts.sourceJobId,
        sourceVideoUrl: opts.sourceVideoUrl,
      }).then((snap) => {
        doneLabels.add("image post");
        reportParallelProgress();
        return snap;
      })
    : Promise.resolve(null as ImagePostSnapshot | null);

  const socialP = outputs.social
    ? postSocialMicroFromTranscript(sharedTranscript, opts.signal).then((snap) => {
        doneLabels.add("X/Threads");
        reportParallelProgress();
        return snap;
      })
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
  /** Latest slide copy for re-render; kept in sync inside slide editors (not only in useEffect). */
  const editableSlidesRef = useRef<ApiSlide[]>([]);
  const transcriptRef = useRef<QueueCarouselSnapshot["transcript"]>([]);
  const previewRenderEpochRef = useRef(0);
  const reRenderInFlightRef = useRef(false);
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
  const [reRenderProgress, setReRenderProgress] = useState<string | null>(null);
  const [reRenderError, setReRenderError] = useState<string | null>(null);
  const [downloadAllZipsLoading, setDownloadAllZipsLoading] = useState(false);
  const [shortReprocessBusy, setShortReprocessBusy] = useState(false);
  const [shortReprocessProgress, setShortReprocessProgress] = useState<
    string | null
  >(null);
  const [shortResumeBusy, setShortResumeBusy] = useState(false);
  const [shortResumeMessage, setShortResumeMessage] = useState<string | null>(
    null
  );
  const shortResumeInFlightRef = useRef<Set<string>>(new Set());
  const shortJobPollLockRef = useRef<Set<string>>(new Set());
  const shortResumeGiveUpRef = useRef<Set<string>>(new Set());
  const shortResumeAttemptRef = useRef<Map<string, number>>(new Map());
  const shortEditorialHydratedRef = useRef<Set<string>>(new Set());
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
  const processQueueLoopRef = useRef<() => void>(() => undefined);
  const queueProcessAbortRef = useRef<AbortController | null>(null);
  const activeQueueIdRef = useRef<string | null>(null);
  /** Prevents overlapping Short re-process runs (e.g. double-click before React re-renders). */
  const shortReprocessInFlightRef = useRef(false);

  const [studioOutputs, setStudioOutputs] =
    useState<StudioOutputToggles>(DEFAULT_STUDIO_OUTPUTS);
  const studioOutputsRef = useRef<StudioOutputToggles>(DEFAULT_STUDIO_OUTPUTS);

  useEffect(() => {
    studioOutputsRef.current = studioOutputs;
  }, [studioOutputs]);

  const mobileKeepAwake =
    loading ||
    reRenderLoading ||
    shortReprocessBusy ||
    shortResumeBusy ||
    queue.some((q) => q.status === "processing" || q.status === "pending");
  useMobileProcessingWakeLock(mobileKeepAwake);

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
    transcriptRef.current = transcript;
  }, [transcript]);
  useEffect(() => {
    imagePostFrameTimeRef.current = imagePost?.frameTimeSec;
  }, [imagePost?.frameTimeSec]);
  useEffect(() => {
    frameColorAdjustRef.current = frameColorAdjust;
  }, [frameColorAdjust]);

  /**
   * Phase 2.0 / 2.1 — auto-upload generated assets (slide PNGs, image-post
   * JPEG, and Short reel MP4) to Bunny Storage as soon as they appear on the
   * snapshot / queue. Best-effort: failures are logged and the snapshot
   * stays without `bunnyUrls`, so legacy base64 + `.data/daemon-reels` paths
   * still work as fallbacks.
   *
   * Known limitations (Phase 2.2+):
   *   - Re-render / re-edit flows keep the old `bunnyUrls` and don't re-upload.
   *   - Short re-process produces a new shortOutputFile; the original Bunny URL
   *     stays in the snapshot until the snapshot is recreated.
   */
  const bunnyUploadInFlightRef = useRef<Set<string>>(new Set());
  // Uploads for reel MP4s are keyed separately because the source is on the
  // queue (`q.shortOutputFile`) not the snapshot, and we don't want a slide
  // upload in flight to also block the reel upload (they're independent).
  const bunnyReelUploadInFlightRef = useRef<Set<string>>(new Set());
  const previewRehydrateInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const [queueId, snap] of Object.entries(queueResults)) {
      if (bunnyUploadInFlightRef.current.has(queueId)) continue;

      const bunny = snap.bunnyUrls;
      const slides = snap.slidePreviewBase64s ?? [];
      const slidesIg = snap.slidePreviewBase64sInstagram ?? [];
      const imagePost = snap.imagePost?.imageBase64 ?? null;
      const slideVersion = snap.slidesAssetVersion ?? 0;
      const needsSlideUpload =
        slides.length > 0 && !(bunny?.slideUrls?.length ?? 0);
      const needsSlideIgUpload =
        slidesIg.length > 0 && !(bunny?.slideUrlsInstagram?.length ?? 0);
      const needsImagePostUpload =
        Boolean(imagePost) && !bunny?.imagePostUrl?.trim();
      if (!needsSlideUpload && !needsSlideIgUpload && !needsImagePostUpload) {
        continue;
      }

      bunnyUploadInFlightRef.current.add(queueId);
      const slideVersionAtStart = slideVersion;
      (async () => {
        try {
          const [slideUrlsRaw, slideUrlsIgRaw, imagePostUrl] = await Promise.all([
            needsSlideUpload
              ? uploadSlidesToBunnyStorage(slides, {
                  prefix: `${queueId}/slide-v${slideVersion}`,
                })
              : Promise.resolve([] as (string | null)[]),
            needsSlideIgUpload
              ? uploadSlidesToBunnyStorage(slidesIg, {
                  prefix: `${queueId}/slide-ig-v${slideVersion}`,
                })
              : Promise.resolve([] as (string | null)[]),
            needsImagePostUpload && imagePost
              ? uploadImageToBunnyStorage(imagePost, {
                  filename: `${queueId}/image-post.jpg`,
                })
              : Promise.resolve(null),
          ]);
          const slideUrls = slideUrlsRaw.filter((u): u is string => !!u);
          const slideUrlsIg = slideUrlsIgRaw.filter((u): u is string => !!u);
          const bunnyUrls: BunnyAssetUrls = {
            ...(slideUrls.length > 0 ? { slideUrls } : {}),
            ...(slideUrlsIg.length > 0 ? { slideUrlsInstagram: slideUrlsIg } : {}),
            ...(imagePostUrl ? { imagePostUrl } : {}),
          };
          if (Object.keys(bunnyUrls).length === 0) return;
          setQueueResults((qr) => {
            const cur = qr[queueId];
            if (!cur) return qr;
            if ((cur.slidesAssetVersion ?? 0) !== slideVersionAtStart) {
              return qr;
            }
            // Don't clobber URLs added by a parallel run.
            const merged: BunnyAssetUrls = {
              ...(cur.bunnyUrls ?? {}),
              ...bunnyUrls,
            };
            const next = { ...qr, [queueId]: { ...cur, bunnyUrls: merged } };
            queueResultsRef.current = next;
            return next;
          });
        } catch (e) {
          console.warn(`[bunny-upload] queue ${queueId} failed:`, e);
        } finally {
          bunnyUploadInFlightRef.current.delete(queueId);
        }
      })();
    }
  }, [queueResults]);

  /**
   * Phase 3.B — Source video auto-upload. Watches the queue for items
   * whose `file` has bytes (real upload, not a Phase 3.A hydration stub)
   * and uploads the MP4 to Bunny Storage. URL lands on
   * `snap.bunnyUrls.sourceVideoUrl` and rides the Phase 3.A sync to the
   * Hub. Enables re-edit / re-render after browser restart (rehydration
   * via `rehydrateSourceVideoFile` — wired into UI in Phase 3.C).
   */
  const bunnySourceUploadInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const q of queue) {
      if (!q.file || q.file.size === 0) continue; // stub (hydrated) or no file
      const snap = queueResults[q.id];
      if (snap?.bunnyUrls?.sourceVideoUrl) continue;
      if (bunnySourceUploadInFlightRef.current.has(q.id)) continue;

      bunnySourceUploadInFlightRef.current.add(q.id);
      const fileName = q.file.name || "source.mp4";
      (async () => {
        try {
          const url = await uploadFileToBunnyStorage(q.file, {
            filename: `${q.id}/source-${fileName}`,
            contentType: q.file.type || "video/mp4",
          });
          if (!url) return;
          setQueueResults((qr) => {
            const cur = qr[q.id];
            const base: QueueCarouselSnapshot = cur ?? {
              recommendation: null,
              effectiveType: null,
              editableSlides: [],
              transcript: [],
              durationSec: null,
              zipBase64: null,
              firstSlidePreviewBase64: null,
              slidePreviewBase64s: null,
              socialCaption: "",
              layoutId: "stacked_center" as LayoutId,
              carouselOverride: "",
              backgroundSource: "video_moments" as BackgroundSource,
              backgroundFile: null,
              imagePost: null,
              imagePostError: null,
              socialMicro: null,
              socialMicroError: null,
              processTiming: null,
              frameColorAdjust: DEFAULT_FRAME_COLOR_ADJUST,
            };
            const merged: BunnyAssetUrls = {
              ...(base.bunnyUrls ?? {}),
              sourceVideoUrl: url,
            };
            const next = { ...qr, [q.id]: { ...base, bunnyUrls: merged } };
            queueResultsRef.current = next;
            return next;
          });
        } catch (e) {
          console.warn(`[bunny-upload] source video ${q.id} failed:`, e);
        } finally {
          bunnySourceUploadInFlightRef.current.delete(q.id);
        }
      })();
    }
  }, [queue, queueResults]);

  /**
   * Phase 3.B — fetch a queue item's source video MP4 from its Bunny URL
   * and reconstruct a real `File` (replacing the stub created during
   * hydration). UI callers should invoke this before any flow that needs
   * the raw video bytes (re-process, re-render, regenerate). Returns the
   * upgraded File on success, or `null` if the URL isn't available / the
   * fetch fails.
   *
   * NOT YET WIRED into UI handlers — that's Phase 3.C. Exposed here so
   * any caller can opt in.
   */
  const rehydrateSourceVideoFile = useCallback(
    async (queueItemId: string): Promise<File | null> => {
      const snap = queueResultsRef.current[queueItemId];
      const url = snap?.bunnyUrls?.sourceVideoUrl;
      if (!url) return null;
      const existing = queueRef.current.find((x) => x.id === queueItemId);
      if (!existing) return null;
      // If we already have real bytes, no need to refetch.
      if (existing.file && existing.file.size > 0) return existing.file;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          console.warn(
            `[rehydrate] source video fetch ${res.status} for ${queueItemId}`,
          );
          return null;
        }
        const bytes = await res.arrayBuffer();
        const fileName =
          existing.file?.name && existing.file.name.length > 0
            ? existing.file.name
            : "source.mp4";
        const upgraded = new File([bytes], fileName, { type: "video/mp4" });
        setQueue((prev) => {
          const next = prev.map((x) =>
            x.id === queueItemId ? { ...x, file: upgraded } : x,
          );
          queueRef.current = next;
          return next;
        });
        return upgraded;
      } catch (e) {
        console.warn(`[rehydrate] source video ${queueItemId} crashed:`, e);
        return null;
      }
    },
    [],
  );

  /**
   * Phase 2.1 — Reel MP4 auto-upload. Watches the queue for items with a
   * `shortOutputFile` and uploads the MP4 to Bunny Storage. The resulting
   * URL goes onto the queue's snapshot (creating an empty snapshot for
   * Short-only items if needed, so the schedule flow can pick it up).
   */
  useEffect(() => {
    for (const q of queue) {
      const reelFile = q.shortOutputFile;
      if (!reelFile) continue;
      const snap = queueResults[q.id];
      if (snap?.bunnyUrls?.reelMp4Url) continue;
      if (bunnyReelUploadInFlightRef.current.has(q.id)) continue;

      bunnyReelUploadInFlightRef.current.add(q.id);
      (async () => {
        try {
          const rev =
            q.shortOutputRevision != null && q.shortOutputRevision > 0
              ? q.shortOutputRevision
              : Date.now();
          const url = await uploadFileToBunnyStorage(reelFile, {
            filename: `${q.id}/reel-v${rev}.mp4`,
            contentType: "video/mp4",
          });
          if (!url) return;
          setQueueResults((qr) => {
            const cur = qr[q.id];
            // Create a minimal snapshot if the Short-only path never built one.
            const base: QueueCarouselSnapshot = cur ?? {
              recommendation: null,
              effectiveType: null,
              editableSlides: [],
              transcript: [],
              durationSec: null,
              zipBase64: null,
              firstSlidePreviewBase64: null,
              slidePreviewBase64s: null,
              socialCaption: "",
              layoutId: "stacked_center" as LayoutId,
              carouselOverride: "",
              backgroundSource: "video_moments" as BackgroundSource,
              backgroundFile: null,
              imagePost: null,
              imagePostError: null,
              socialMicro: null,
              socialMicroError: null,
              processTiming: null,
              frameColorAdjust: DEFAULT_FRAME_COLOR_ADJUST,
            };
            const merged: BunnyAssetUrls = {
              ...(base.bunnyUrls ?? {}),
              reelMp4Url: url,
            };
            const next = { ...qr, [q.id]: { ...base, bunnyUrls: merged } };
            queueResultsRef.current = next;
            return next;
          });
        } catch (e) {
          console.warn(`[bunny-upload] reel ${q.id} failed:`, e);
        } finally {
          bunnyReelUploadInFlightRef.current.delete(q.id);
        }
      })();
    }
  }, [queue, queueResults]);

  /**
   * Phase 3.A — Home-queue persistence via Hub.
   *
   * On mount: fetch the user's MultiplierQueueItem list from the Hub and
   * hydrate the in-memory `queue` + `queueResults` so the home page picks
   * up where it left off (across browser refresh / device switch). Hydrated
   * items use a stub File (empty bytes, real name) — the actual source
   * video bytes aren't persisted yet (that's Phase 2.2 / TUS source video).
   * UI that just reads `file.name` works; UI that tries to re-process or
   * re-render needs the user to re-upload.
   *
   * On every queue/snapshot mutation: fire-and-forget upsert to Hub
   * (debounced per id). The Hub treats the payload as opaque Json.
   */
  const MULTIPLIER_HUB_SYNC_DEBOUNCE_MS = 300;
  const [hubQueueHydrationDone, setHubQueueHydrationDone] = useState(false);
  const hubHydratedRef = useRef<Set<string>>(new Set());
  const hubSyncTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Suppress the auto-sync effect for one cycle on freshly-hydrated items
  // (they came FROM the Hub, no need to upsert back immediately).
  const hubSyncSuppressRef = useRef<Set<string>>(new Set());
  /** Skip one debounced upsert after an immediate flush (e.g. rename). */
  const hubSyncSkipDebounceRef = useRef<Set<string>>(new Set());
  const hubSyncFingerprintRef = useRef<Map<string, string>>(new Map());

  function hubSyncFingerprint(
    q: VideoQueueItem,
    snap: QueueCarouselSnapshot | undefined,
  ): string {
    return JSON.stringify({
      status: q.status,
      label: queueItemScheduleLabel(q),
      displayLabel: q.displayLabel ?? null,
      short: Boolean(q.shortOutputFile) || Boolean(q.shortJobId),
      payload: buildHubPayload(snap, q),
    });
  }

  function hubStatusFor(s: VideoQueueItem["status"]): "processing" | "done" | "failed" {
    if (s === "done") return "done";
    if (s === "error") return "failed";
    return "processing";
  }

  function deriveKindForHub(
    q: VideoQueueItem,
    snap: QueueCarouselSnapshot | undefined,
  ): MultiplierQueueKind | null {
    if (q.shortOutputFile || snap?.bunnyUrls?.reelMp4Url || q.shortJobId) return "short";
    if (snap?.imagePost?.imageBase64 || snap?.bunnyUrls?.imagePostUrl) {
      const hasCarousel =
        (snap?.slidePreviewBase64s ?? []).length > 0 ||
        (snap?.bunnyUrls?.slideUrls ?? []).length > 0;
      // Prefer carousel kind when both image-post + slides exist (carousels are richer).
      return hasCarousel ? "carousel" : "photo";
    }
    if ((snap?.slidePreviewBase64s ?? []).length > 0) return "carousel";
    if ((snap?.bunnyUrls?.slideUrls ?? []).length > 0) return "carousel";
    return null;
  }

  function imagePostCopyFromSnapshot(
    ip: ImagePostSnapshot | null | undefined,
  ): ImagePostCopyPayload | undefined {
    if (!ip) return undefined;
    const hook = ip.hook.trim();
    const microCta = ip.microCta.trim();
    const caption = ip.caption.trim();
    const altText = ip.altText.trim();
    if (!hook && !microCta && !caption && !altText) return undefined;
    return {
      ...(hook ? { hook } : {}),
      ...(microCta ? { microCta } : {}),
      ...(caption ? { caption } : {}),
      ...(altText ? { altText } : {}),
      ...(ip.evidenceSegmentIds.length > 0
        ? { evidenceSegmentIds: ip.evidenceSegmentIds }
        : {}),
      ...(typeof ip.frameTimeSec === "number" && Number.isFinite(ip.frameTimeSec)
        ? { frameTimeSec: ip.frameTimeSec }
        : {}),
    };
  }

  function imagePostFromHubPayload(
    payload: MultiplierQueuePayload,
    transcript: QueueCarouselSnapshot["transcript"],
    durationSec: number | null,
    imageBase64 = "",
  ): ImagePostSnapshot | null {
    const copy = payload.imagePostCopy;
    const hasBunnyImage = Boolean(payload.bunnyUrls?.imagePostUrl?.trim());
    if (!copy && !hasBunnyImage) return null;
    const hook = typeof copy?.hook === "string" ? copy.hook : "";
    const microCta = typeof copy?.microCta === "string" ? copy.microCta : "";
    const caption = typeof copy?.caption === "string" ? copy.caption : "";
    const altText = typeof copy?.altText === "string" ? copy.altText : "";
    if (!hasBunnyImage && !hook && !microCta && !caption && !altText) {
      return null;
    }
    return {
      hook,
      microCta,
      caption,
      altText,
      evidenceSegmentIds: Array.isArray(copy?.evidenceSegmentIds)
        ? copy!.evidenceSegmentIds!.filter((n) => typeof n === "number")
        : [],
      transcript,
      durationSec: durationSec ?? 0,
      frameTimeSec:
        typeof copy?.frameTimeSec === "number" ? copy.frameTimeSec : 0,
      imageBase64,
    };
  }

  function buildHubPayload(
    snap: QueueCarouselSnapshot | undefined,
    q?: Pick<
      VideoQueueItem,
      | "shortJobId"
      | "shortOutputRevision"
      | "processingJobId"
      | "outputs"
      | "driveFileId"
      | "stitchJobId"
      | "error"
    >,
  ): MultiplierQueuePayload {
    if (!snap) {
      return {
        v: 1,
        ...(q?.shortJobId ? { shortJobId: q.shortJobId } : {}),
        ...(q?.shortOutputRevision != null && q.shortOutputRevision > 0
          ? { shortOutputRevision: q.shortOutputRevision }
          : {}),
        ...(q?.processingJobId ? { processingJobId: q.processingJobId } : {}),
        ...(q?.driveFileId ? { driveFileId: q.driveFileId } : {}),
        ...(q?.stitchJobId ? { stitchJobId: q.stitchJobId } : {}),
        ...(q?.outputs ? { outputs: q.outputs } : {}),
        ...(q?.error ? { error: q.error } : {}),
      };
    }
    return {
      v: 1,
      ...(snap.bunnyUrls ? { bunnyUrls: snap.bunnyUrls } : {}),
      ...(q?.shortJobId ? { shortJobId: q.shortJobId } : {}),
      ...(q?.shortOutputRevision != null && q.shortOutputRevision > 0
        ? { shortOutputRevision: q.shortOutputRevision }
        : {}),
      ...(q?.processingJobId ? { processingJobId: q.processingJobId } : {}),
      ...(q?.driveFileId ? { driveFileId: q.driveFileId } : {}),
      ...(q?.stitchJobId ? { stitchJobId: q.stitchJobId } : {}),
      ...(q?.outputs ? { outputs: q.outputs } : {}),
      ...(q?.error ? { error: q.error } : {}),
      ...(snap.socialCaption ? { socialCaption: snap.socialCaption } : {}),
      ...(() => {
        const copy = imagePostCopyFromSnapshot(snap.imagePost);
        return copy ? { imagePostCopy: copy } : {};
      })(),
      ...(snap.durationSec != null ? { durationSec: snap.durationSec } : {}),
      ...(snap.editableSlides && snap.editableSlides.length > 0
        ? {
            editableSlides: snap.editableSlides.map((s) => ({
              headline: typeof s.headline === "string" ? s.headline : undefined,
              body: typeof s.body === "string" ? s.body : undefined,
            })),
          }
        : {}),
      ...(snap.transcript && snap.transcript.length > 0
        ? {
            transcript:
              normalizeTranscriptSegments(snap.transcript) ?? snap.transcript,
          }
        : {}),
      ...(snap.effectiveType != null ? { effectiveType: snap.effectiveType } : {}),
      ...(snap.layoutId ? { layoutId: snap.layoutId } : {}),
      ...(snap.carouselOverride
        ? { carouselOverride: snap.carouselOverride }
        : {}),
    };
  }

  // ---- Hydrate once on mount -----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listMultiplierQueueFromHub({ limit: 100 });
      if (cancelled) return;
      if (!res.ok) {
        console.warn("[multiplier-queue] Hub list failed:", res.message);
        return;
      }
      const itemsToHydrate: HubMultiplierQueueItem[] = res.data;
      if (itemsToHydrate.length === 0) return;

      // Build VideoQueueItem stubs + QueueCarouselSnapshot stubs.
      const newQueueRows: VideoQueueItem[] = [];
      const newSnapshots: Record<string, QueueCarouselSnapshot> = {};
      for (const item of itemsToHydrate) {
        const payload =
          (item.payload && typeof item.payload === "object"
            ? (item.payload as MultiplierQueuePayload)
            : { v: 1 as const });
        // Stub File: zero bytes, real name + type. Lets UI render the name;
        // re-process / re-upload flows will detect empty bytes and prompt.
        const stubFile = new File([], item.videoLabel || "video.mp4", {
          type: "video/mp4",
        });
        const payloadShortJobId =
          typeof payload.shortJobId === "string" && payload.shortJobId.trim()
            ? payload.shortJobId.trim()
            : undefined;
        const payloadRevision =
          typeof payload.shortOutputRevision === "number" &&
          payload.shortOutputRevision > 0
            ? Math.floor(payload.shortOutputRevision)
            : undefined;
        const processingJobId =
          typeof payload.processingJobId === "string" &&
          payload.processingJobId.trim()
            ? payload.processingJobId.trim()
            : undefined;
        const driveFileId =
          typeof payload.driveFileId === "string" && payload.driveFileId.trim()
            ? payload.driveFileId.trim()
            : undefined;
        const stitchJobId =
          typeof payload.stitchJobId === "string" && payload.stitchJobId.trim()
            ? payload.stitchJobId.trim()
            : undefined;
        const sourceVideoUrl =
          typeof payload.bunnyUrls?.sourceVideoUrl === "string" &&
          payload.bunnyUrls.sourceVideoUrl.trim()
            ? payload.bunnyUrls.sourceVideoUrl.trim()
            : undefined;
        // Stuck overnight batch: Hub row is "processing" with a Bunny URL but
        // no ProcessingJob (durable create used to 404 via Hub). Re-queue on
        // the server instead of marking interrupted.
        const canResumeDurable =
          !processingJobId &&
          Boolean(driveFileId || stitchJobId || sourceVideoUrl) &&
          item.status === "processing";
        const durableProcessing = Boolean(processingJobId) || canResumeDurable;
        const interruptedProcessing =
          item.status === "processing" &&
          stubFile.size === 0 &&
          !durableProcessing &&
          !driveFileId &&
          !stitchJobId &&
          !sourceVideoUrl;
        const outputs =
          payload.outputs && typeof payload.outputs === "object"
            ? payload.outputs
            : undefined;
        const queueStatus: VideoQueueItem["status"] = localQueueStatusFromHub({
          hubStatus: item.status,
          outputs,
          bunnyUrls: payload.bunnyUrls,
          interrupted: interruptedProcessing,
          canResume: canResumeDurable,
        });
        const progressFromOutputs = (() => {
          if (canResumeDurable) return "Re-queueing on server…";
          if (!outputs) return undefined;
          for (const key of ["carousel", "photo", "short"] as const) {
            const p = outputs[key]?.progress;
            if (typeof p === "string" && p.trim()) return p.trim();
          }
          if (item.status === "processing") return "Processing on server…";
          return undefined;
        })();
        const queueRow: VideoQueueItem = {
          id: item.id,
          file: stubFile,
          status: queueStatus,
          ...(driveFileId ? { driveFileId } : {}),
          ...(stitchJobId ? { stitchJobId } : {}),
          ...(payloadShortJobId ? { shortJobId: payloadShortJobId } : {}),
          ...(payloadRevision != null
            ? { shortOutputRevision: payloadRevision }
            : {}),
          ...(processingJobId
            ? { processingJobId, durableProcessing: true }
            : canResumeDurable
              ? { durableProcessing: true }
              : {}),
          ...(outputs ? { outputs } : {}),
          ...(progressFromOutputs ? { progress: progressFromOutputs } : {}),
          ...(outputs?.short?.status === "failed" && outputs.short.error
            ? { shortError: outputs.short.error }
            : {}),
          ...(queueStatus === "error"
            ? {
                error: interruptedProcessing
                  ? "Processing was interrupted. Re-upload your video or return from Stitch to continue."
                  : sanitizeQueueErrorMessage(
                      (typeof payload.error === "string" && payload.error.trim()
                        ? payload.error.trim()
                        : failedOutputSummary(outputs) ||
                          "Processing failed."),
                    ),
              }
            : {}),
        };
        const hydratedTranscript =
          normalizeTranscriptSegments(payload.transcript) ?? [];
        const snap: QueueCarouselSnapshot = {
          recommendation: null,
          effectiveType:
            typeof payload.effectiveType === "string"
              ? (payload.effectiveType as QueueCarouselSnapshot["effectiveType"])
              : null,
          editableSlides: Array.isArray(payload.editableSlides)
            ? payload.editableSlides.map((s, i) => ({
                order: i + 1,
                headline: typeof s.headline === "string" ? s.headline : "",
                ...(typeof s.body === "string" ? { body: s.body } : {}),
                evidenceSegmentIds: [],
              }))
            : [],
          transcript: hydratedTranscript,
          durationSec:
            typeof payload.durationSec === "number"
              ? payload.durationSec
              : null,
          zipBase64: null,
          firstSlidePreviewBase64: null,
          slidePreviewBase64s: null,
          socialCaption:
            typeof payload.socialCaption === "string"
              ? payload.socialCaption
              : "",
          layoutId: (payload.layoutId as LayoutId | undefined) ?? "stacked_center",
          carouselOverride:
            (payload.carouselOverride as CarouselType | "" | undefined) ?? "",
          backgroundSource: "video_moments",
          backgroundFile: null,
          imagePost: imagePostFromHubPayload(
            payload,
            hydratedTranscript,
            typeof payload.durationSec === "number" ? payload.durationSec : null,
          ),
          imagePostError: null,
          socialMicro: null,
          socialMicroError: null,
          processTiming: null,
          frameColorAdjust: DEFAULT_FRAME_COLOR_ADJUST,
          ...(payload.bunnyUrls ? { bunnyUrls: payload.bunnyUrls } : {}),
        };
        if (queueRow.status === "done") {
          queueRow.studioContentBaseline = studioContentFingerprint(
            queueRow,
            snap
          );
        }
        newQueueRows.push(queueRow);
        newSnapshots[item.id] = snap;
        hubHydratedRef.current.add(item.id);
        hubSyncSuppressRef.current.add(item.id);
      }

      // Merge into existing state. Promote already-local stuck rows (browser
      // fallback / open tab) onto durable re-queue when Hub has a source URL.
      setQueue((prev) => {
        const byId = new Map(prev.map((q) => [q.id, q]));
        for (const row of newQueueRows) {
          const existing = byId.get(row.id);
          if (!existing) {
            byId.set(row.id, row);
            continue;
          }
          if (
            row.durableProcessing &&
            !row.processingJobId &&
            row.status === "pending" &&
            !existing.processingJobId &&
            existing.status !== "done"
          ) {
            byId.set(row.id, {
              ...existing,
              status: "pending",
              durableProcessing: true,
              processingJobId: null,
              progress: row.progress ?? "Re-queueing on server…",
              error: undefined,
            });
          } else if (!byId.has(row.id)) {
            byId.set(row.id, row);
          }
        }
        for (const row of newQueueRows) {
          if (!byId.has(row.id)) byId.set(row.id, row);
        }
        // Preserve order: existing first, then newly hydrated ids.
        const existingIds = new Set(prev.map((q) => q.id));
        const merged = [
          ...prev.map((q) => byId.get(q.id)!),
          ...newQueueRows.filter((r) => !existingIds.has(r.id)),
        ];
        queueRef.current = merged;
        return merged;
      });
      setQueueResults((qr) => {
        const next = { ...qr };
        for (const [id, snap] of Object.entries(newSnapshots)) {
          // Prefer Hub bunny URLs when local snapshot is missing source.
          const cur = next[id];
          if (!cur) {
            next[id] = snap;
            continue;
          }
          next[id] = {
            ...cur,
            bunnyUrls: {
              ...(snap.bunnyUrls ?? {}),
              ...(cur.bunnyUrls ?? {}),
              sourceVideoUrl:
                cur.bunnyUrls?.sourceVideoUrl ||
                snap.bunnyUrls?.sourceVideoUrl,
            },
          };
        }
        queueResultsRef.current = next;
        return next;
      });
    })()
      .catch((e) => {
        console.warn("[multiplier-queue] Hub hydration crashed:", e);
      })
      .finally(() => {
        if (!cancelled) setHubQueueHydrationDone(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushHubSyncForItem = useCallback((id: string) => {
    const q = queueRef.current.find((row) => row.id === id);
    if (!q) return;
    // Avoid clobbering server-worker payload while a durable job is in flight.
    if (
      (q.durableProcessing || q.processingJobId) &&
      (q.status === "processing" || q.status === "pending")
    ) {
      return;
    }
    const pending = hubSyncTimersRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      hubSyncTimersRef.current.delete(id);
    }
    const snap = queueResultsRef.current[id];
    const payload = buildHubPayload(snap, q);
    hubSyncFingerprintRef.current.set(q.id, hubSyncFingerprint(q, snap));
    void upsertMultiplierQueueItemToHub({
      id: q.id,
      videoLabel: queueItemScheduleLabel(q),
      status: hubStatusFor(q.status),
      kind: deriveKindForHub(q, snap),
      payload,
    }).then((r) => {
      if (!r.ok) {
        console.warn(
          `[multiplier-queue] Hub upsert failed for ${q.id}:`,
          r.message,
        );
      }
    });
  }, []);

  // ---- Sync on every mutation ----------------------------------------------
  useEffect(() => {
    for (const q of queue) {
      // Skip the first-cycle re-sync of freshly hydrated items.
      if (hubSyncSuppressRef.current.has(q.id)) {
        hubSyncSuppressRef.current.delete(q.id);
        hubSyncFingerprintRef.current.set(
          q.id,
          hubSyncFingerprint(q, queueResultsRef.current[q.id]),
        );
        continue;
      }
      if (hubSyncSkipDebounceRef.current.has(q.id)) {
        hubSyncSkipDebounceRef.current.delete(q.id);
        continue;
      }
      const snap = queueResultsRef.current[q.id];
      const fp = hubSyncFingerprint(q, snap);
      if (hubSyncFingerprintRef.current.get(q.id) === fp) {
        continue;
      }
      // Debounce per id — bunch up rapid state changes into one upsert.
      const existing = hubSyncTimersRef.current.get(q.id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        hubSyncTimersRef.current.delete(q.id);
        flushHubSyncForItem(q.id);
      }, MULTIPLIER_HUB_SYNC_DEBOUNCE_MS);
      hubSyncTimersRef.current.set(q.id, timer);
    }
    // Cleanup any pending timers on unmount.
    return () => {
      // Intentionally NOT clearing timers here — we want pending upserts to
      // fire even if React tears down the effect mid-debounce. Stale entries
      // self-clean inside the setTimeout callback above.
    };
  }, [queue, queueResults, flushHubSyncForItem]);

  // Backfill studio baselines for done rows (e.g. finished before this field existed).
  useEffect(() => {
    setQueue((prev) => {
      let changed = false;
      const next = prev.map((q) => {
        if (q.status !== "done" || q.studioContentBaseline) return q;
        const snap = queueResultsRef.current[q.id];
        if (!snap && !q.shortOutputFile && !q.shortJobId) return q;
        changed = true;
        return {
          ...q,
          studioContentBaseline: studioContentFingerprint(q, snap ?? null),
        };
      });
      if (changed) queueRef.current = next;
      return changed ? next : prev;
    });
  }, [queue, queueResults]);

  useEffect(() => {
    const flushPending = () => {
      for (const [id, timer] of hubSyncTimersRef.current) {
        clearTimeout(timer);
        hubSyncTimersRef.current.delete(id);
        flushHubSyncForItem(id);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushHubSyncForItem]);

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

  /** Merge live editor state onto a stored snapshot (keeps bunnyUrls, etc.). */
  const mergeWorkspaceSnapshot = useCallback(
    (existing?: QueueCarouselSnapshot): QueueCarouselSnapshot => ({
      ...(existing ?? {}),
      ...buildSnapshotFromWorkspace(),
    }),
    [buildSnapshotFromWorkspace],
  );

  const flushActiveQueueSnapshot = useCallback((): QueueCarouselSnapshot | null => {
    const aid = activeQueueIdRef.current;
    if (!aid) return null;
    const snap = mergeWorkspaceSnapshot(queueResultsRef.current[aid]);
    setQueueResults((qr) => {
      const next = { ...qr, [aid]: snap };
      queueResultsRef.current = next;
      return next;
    });
    return snap;
  }, [mergeWorkspaceSnapshot]);

  const applyPreviewRehydratePatch = useCallback(
    (queueItemId: string, patch: PreviewRehydratePatch) => {
      setQueueResults((qr) => {
        const cur = qr[queueItemId];
        if (!cur) return qr;
        const merged: QueueCarouselSnapshot = { ...cur, ...patch };
        if (patch.imagePost) {
          merged.imagePost = {
            ...(cur.imagePost ?? {}),
            ...patch.imagePost,
          } as ImagePostSnapshot;
        }
        const next = { ...qr, [queueItemId]: merged };
        queueResultsRef.current = next;
        return next;
      });
      if (activeQueueIdRef.current !== queueItemId) return;
      if (patch.slidePreviewBase64s) {
        setSlidePreviewBase64s(patch.slidePreviewBase64s);
      }
      if (patch.slidePreviewBase64sInstagram) {
        setSlidePreviewBase64sInstagram(patch.slidePreviewBase64sInstagram);
      }
      if (patch.firstSlidePreviewBase64 !== undefined) {
        setFirstSlidePreviewBase64(patch.firstSlidePreviewBase64);
      }
      if (patch.imagePost) {
        setImagePost(patch.imagePost);
      }
    },
    [],
  );

  const rehydratePreviewAssetsFromBunny = useCallback(
    async (queueItemId: string) => {
      if (reRenderInFlightRef.current) return;
      const epochAtStart = previewRenderEpochRef.current;
      const snap = queueResultsRef.current[queueItemId];
      if (!snapshotNeedsPreviewRehydrate(snap)) return;
      if (previewRehydrateInFlightRef.current.has(queueItemId)) return;
      previewRehydrateInFlightRef.current.add(queueItemId);
      try {
        const patch = await buildPreviewRehydratePatchFromBunny(snap!);
        if (previewRenderEpochRef.current !== epochAtStart) return;
        if (!patch) return;
        const latest = queueResultsRef.current[queueItemId];
        if (!latest) return;
        const filtered = filterPreviewRehydratePatch(latest, patch);
        if (!filtered) return;
        if (previewRenderEpochRef.current !== epochAtStart) return;

        applyPreviewRehydratePatch(queueItemId, filtered);
      } catch (e) {
        console.warn(`[rehydrate] preview assets ${queueItemId} crashed:`, e);
      } finally {
        previewRehydrateInFlightRef.current.delete(queueItemId);
      }
    },
    [applyPreviewRehydratePatch],
  );

  // After Hub hydration (Bunny URLs, no base64), pull previews back for every
  // queue row — not only the active editor — so Schedule can offer Photo, etc.
  useEffect(() => {
    for (const [id, snap] of Object.entries(queueResults)) {
      if (snapshotNeedsPreviewRehydrate(snap)) {
        void rehydratePreviewAssetsFromBunny(id);
      }
    }
  }, [queueResults, rehydratePreviewAssetsFromBunny]);

  const applySnapshot = useCallback((snap: QueueCarouselSnapshot) => {
    setRecommendation(snap.recommendation);
    setEffectiveType(snap.effectiveType);
    editableSlidesRef.current = snap.editableSlides;
    setEditableSlides(snap.editableSlides);
    setTranscript(normalizeTranscriptSegments(snap.transcript) ?? []);
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
    editableSlidesRef.current = [];
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
      if (prev === id) {
        if (snapshotNeedsPreviewRehydrate(queueResultsRef.current[id])) {
          void rehydratePreviewAssetsFromBunny(id);
        }
        return;
      }
      setQueueResults((qr) => {
        let next = qr;
        if (
          prev &&
          prev !== id &&
          queueRef.current.some((q) => q.id === prev)
        ) {
          next = { ...qr, [prev]: mergeWorkspaceSnapshot(qr[prev]) };
        }
        queueResultsRef.current = next;
        return next;
      });
      setActiveQueueId(id);
      const snap = queueResultsRef.current[id];
      if (snap) {
        applySnapshot(snap);
        void rehydratePreviewAssetsFromBunny(id);
      } else {
        clearWorkspaceForNewVideo();
      }
    },
    [
      applySnapshot,
      mergeWorkspaceSnapshot,
      clearWorkspaceForNewVideo,
      rehydratePreviewAssetsFromBunny,
    ]
  );

  const renameQueueItem = useCallback(
    (id: string, displayLabel: string) => {
      const trimmed = displayLabel.trim();
      const next = queueRef.current.map((q) =>
        q.id === id
          ? { ...q, displayLabel: trimmed || undefined }
          : q
      );
      queueRef.current = next;
      setQueue(next);
      hubSyncSkipDebounceRef.current.add(id);
      flushHubSyncForItem(id);
    },
    [flushHubSyncForItem]
  );

  const removeQueueItem = useCallback(
    (id: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      if (
        !item ||
        (item.status !== "done" &&
          item.status !== "error" &&
          item.status !== "processing" &&
          item.status !== "pending")
      ) {
        return;
      }

      if (item.status === "processing") {
        queueProcessAbortRef.current?.abort();
      }

      const hubTimer = hubSyncTimersRef.current.get(id);
      if (hubTimer) {
        clearTimeout(hubTimer);
        hubSyncTimersRef.current.delete(id);
      }
      hubHydratedRef.current.delete(id);
      hubSyncSuppressRef.current.delete(id);
      hubSyncFingerprintRef.current.delete(id);
      bunnyUploadInFlightRef.current.delete(id);
      bunnyReelUploadInFlightRef.current.delete(id);
      shortResumeInFlightRef.current.delete(id);
      shortResumeGiveUpRef.current.delete(id);
      shortResumeAttemptRef.current.delete(id);

      const nextQueue = queueRef.current.filter((q) => q.id !== id);
      queueRef.current = nextQueue;
      setQueue(nextQueue);

      setQueueResults((qr) => {
        const { [id]: _removed, ...rest } = qr;
        queueResultsRef.current = rest;
        return rest;
      });

      void deleteMultiplierQueueItemFromHub(id).then((r) => {
        if (!r.ok) {
          console.warn(
            `[multiplier-queue] Hub delete failed for ${id}:`,
            r.message,
          );
        }
      });

      if (
        !nextQueue.some((q) => q.status === "pending" || q.status === "processing")
      ) {
        setLoading(false);
      }

      if (activeQueueIdRef.current !== id) return;

      if (item.status === "error" && activeQueueIdRef.current === id) {
        setError(null);
      }

      const fallback =
        [...nextQueue].reverse().find((q) => q.status === "done") ??
        [...nextQueue]
          .reverse()
          .find((q) => q.status !== "processing" && q.status !== "pending") ??
        nextQueue[nextQueue.length - 1];
      if (fallback) {
        setActiveQueueId(fallback.id);
        const snap = queueResultsRef.current[fallback.id];
        if (snap) {
          applySnapshot(snap);
          void rehydratePreviewAssetsFromBunny(fallback.id);
        } else {
          clearWorkspaceForNewVideo();
        }
      } else {
        setActiveQueueId(null);
        clearWorkspaceForNewVideo();
      }
    },
    [applySnapshot, clearWorkspaceForNewVideo, rehydratePreviewAssetsFromBunny],
  );

  const recoverStaleProcessingRows = useCallback(() => {
    const stale = queueRef.current.some((q) => q.status === "processing");
    if (!stale) return false;
    let changed = false;
    const next = queueRef.current.map((q) => {
      if (q.status !== "processing") return q;
      // Server-durable jobs keep polling — do not reset to pending/error.
      if (q.durableProcessing || q.processingJobId) {
        return q;
      }
      // Drive-ingest rows are resumable: servers re-pull the video by id.
      if (q.file.size > 0 || q.driveFileId || q.stitchJobId) {
        changed = true;
        return {
          ...q,
          status: "pending" as const,
          progress: "Resuming after refresh…",
          error: undefined,
          durableProcessing: true,
        };
      }
      changed = true;
      return {
        ...q,
        status: "error" as const,
        progress: undefined,
        error:
          "Processing was interrupted. Re-upload your video or return from Stitch to continue.",
      };
    });
    if (changed) {
      queueRef.current = next;
      setQueue(next);
    }
    return changed;
  }, []);

  const hubPollInFlightRef = useRef(false);
  const durableEnqueueInFlightRef = useRef(0);
  const DURABLE_UPLOAD_CONCURRENCY = 3;

  const applyHubItemToLocalQueue = useCallback(
    (item: HubMultiplierQueueItem) => {
      const payload =
        item.payload && typeof item.payload === "object"
          ? (item.payload as MultiplierQueuePayload)
          : ({ v: 1 } as MultiplierQueuePayload);
      const outputs = payload.outputs;
      const localStatus: VideoQueueItem["status"] = localQueueStatusFromHub({
        hubStatus: item.status,
        outputs,
        bunnyUrls: payload.bunnyUrls,
      });
      const progress =
        outputs?.carousel?.progress ||
        outputs?.photo?.progress ||
        outputs?.short?.progress ||
        (localStatus === "processing" ? "Processing on server…" : undefined);
      const shortJobId =
        typeof payload.shortJobId === "string" && payload.shortJobId.trim()
          ? payload.shortJobId.trim()
          : undefined;
      const shortError =
        outputs?.short?.status === "failed"
          ? outputs.short.error
          : undefined;

      setQueue((prev) => {
        const next = prev.map((q) => {
          if (q.id !== item.id) return q;
          return {
            ...q,
            status: localStatus,
            progress,
              error:
              localStatus === "error"
                ? sanitizeQueueErrorMessage(
                    (typeof payload.error === "string" && payload.error.trim()
                      ? payload.error.trim()
                      : undefined) ||
                      failedOutputSummary(outputs) ||
                      q.error ||
                      "Processing failed.",
                  )
                : undefined,
            outputs,
            processingJobId:
              typeof payload.processingJobId === "string"
                ? payload.processingJobId
                : q.processingJobId,
            durableProcessing: true,
            ...(typeof payload.driveFileId === "string" &&
            payload.driveFileId.trim()
              ? { driveFileId: payload.driveFileId.trim() }
              : {}),
            ...(typeof payload.stitchJobId === "string" &&
            payload.stitchJobId.trim()
              ? { stitchJobId: payload.stitchJobId.trim() }
              : {}),
            ...(shortJobId ? { shortJobId } : {}),
            ...(typeof payload.shortOutputRevision === "number"
              ? { shortOutputRevision: payload.shortOutputRevision }
              : {}),
            ...(shortError ? { shortError } : { shortError: undefined }),
            ...(localStatus === "done" && !q.studioContentBaseline
              ? {
                  studioContentBaseline: studioContentFingerprint(
                    {
                      shortOutputRevision:
                        typeof payload.shortOutputRevision === "number"
                          ? payload.shortOutputRevision
                          : q.shortOutputRevision,
                    },
                    queueResultsRef.current[q.id] ?? null,
                  ),
                }
              : {}),
          };
        });
        queueRef.current = next;
        return next;
      });

      // Merge Hub snapshot fields onto local queueResults when present.
      setQueueResults((qr) => {
        const cur = qr[item.id];
        const nextSnap: QueueCarouselSnapshot = {
          recommendation: cur?.recommendation ?? null,
          effectiveType:
            typeof payload.effectiveType === "string"
              ? (payload.effectiveType as QueueCarouselSnapshot["effectiveType"])
              : (cur?.effectiveType ?? null),
          editableSlides: Array.isArray(payload.editableSlides)
            ? payload.editableSlides.map((s, i) => ({
                order: i + 1,
                headline: typeof s.headline === "string" ? s.headline : "",
                ...(typeof s.body === "string" ? { body: s.body } : {}),
                evidenceSegmentIds: [],
              }))
            : (cur?.editableSlides ?? []),
          transcript:
            normalizeTranscriptSegments(payload.transcript) ??
            cur?.transcript ??
            [],
          durationSec:
            typeof payload.durationSec === "number"
              ? payload.durationSec
              : (cur?.durationSec ?? null),
          zipBase64: cur?.zipBase64 ?? null,
          firstSlidePreviewBase64: cur?.firstSlidePreviewBase64 ?? null,
          slidePreviewBase64s: cur?.slidePreviewBase64s ?? null,
          slidePreviewBase64sInstagram:
            cur?.slidePreviewBase64sInstagram ?? null,
          socialCaption:
            typeof payload.socialCaption === "string"
              ? payload.socialCaption
              : (cur?.socialCaption ?? ""),
          layoutId:
            (payload.layoutId as LayoutId | undefined) ??
            cur?.layoutId ??
            "stacked_center",
          carouselOverride:
            (payload.carouselOverride as CarouselType | "" | undefined) ??
            cur?.carouselOverride ??
            "",
          backgroundSource: cur?.backgroundSource ?? "video_moments",
          backgroundFile: cur?.backgroundFile ?? null,
          imagePost:
            imagePostFromHubPayload(
              payload,
              normalizeTranscriptSegments(payload.transcript) ??
                cur?.transcript ??
                [],
              typeof payload.durationSec === "number"
                ? payload.durationSec
                : (cur?.durationSec ?? null),
            ) ??
            cur?.imagePost ??
            null,
          imagePostError: cur?.imagePostError ?? null,
          socialMicro: cur?.socialMicro ?? null,
          socialMicroError: cur?.socialMicroError ?? null,
          processTiming: cur?.processTiming ?? null,
          frameColorAdjust: cur?.frameColorAdjust ?? DEFAULT_FRAME_COLOR_ADJUST,
          bunnyUrls: {
            ...(cur?.bunnyUrls ?? {}),
            ...(payload.bunnyUrls ?? {}),
          },
        };
        const next = { ...qr, [item.id]: nextSnap };
        queueResultsRef.current = next;
        if (activeQueueIdRef.current === item.id && localStatus === "done") {
          applySnapshot(nextSnap);
          void rehydratePreviewAssetsFromBunny(item.id);
        }
        return next;
      });
    },
    [applySnapshot, rehydratePreviewAssetsFromBunny],
  );

  const pollDurableQueueFromHub = useCallback(async () => {
    if (hubPollInFlightRef.current) return;
    hubPollInFlightRef.current = true;
    try {
      const res = await listMultiplierQueueFromHub({ limit: 100 });
      if (!res.ok) return;
      const localDurableIds = new Set(
        queueRef.current
          .filter((q) => q.durableProcessing || q.processingJobId)
          .map((q) => q.id),
      );
      if (localDurableIds.size === 0) return;
      for (const item of res.data) {
        if (!localDurableIds.has(item.id)) continue;
        applyHubItemToLocalQueue(item);
      }
    } finally {
      hubPollInFlightRef.current = false;
    }
  }, [applyHubItemToLocalQueue]);

  useEffect(() => {
    const hasDurable = queue.some(
      (q) =>
        (q.durableProcessing || q.processingJobId) &&
        (q.status === "processing" || q.status === "pending"),
    );
    if (!hasDurable) return;
    void pollDurableQueueFromHub();
    // Kick once on enter; rely on Coolify cron (every minute) for steady drain.
    // Do NOT kick every few seconds — overlapping process-due handlers stampede
    // and claim the whole queue at once (OOM / aborted leases).
    void kickMultiplierProcessingDue();
    const poll = window.setInterval(() => {
      void pollDurableQueueFromHub();
    }, 4000);
    const kick = window.setInterval(() => {
      void kickMultiplierProcessingDue();
    }, 60_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(kick);
    };
  }, [queue, pollDurableQueueFromHub]);

  const enqueueDurableJobForItem = useCallback(
    async (item: VideoQueueItem) => {
      const formats = withEffectiveStudioOutputs(studioOutputsRef.current);
      const patchItem = (patch: Partial<VideoQueueItem>) => {
        setQueue((prev) => {
          const next = prev.map((q) =>
            q.id === item.id ? { ...q, ...patch } : q,
          );
          queueRef.current = next;
          return next;
        });
      };

      if (item.processingJobId) {
        patchItem({
          status: "processing",
          progress: "Queued on server…",
          processingJobId: item.processingJobId,
          durableProcessing: true,
        });
        void kickMultiplierProcessingDue();
        return;
      }

      patchItem({
        status: "processing",
        progress:
          item.driveFileId || item.stitchJobId
            ? "Queueing server job…"
            : "Uploading source for background processing…",
        durableProcessing: true,
        error: undefined,
      });

      let sourceVideoUrl: string | undefined;
      try {
        const existingUrl = storedSourceVideoUrl(
          item.id,
          queueResultsRef.current,
        );
        if (existingUrl) {
          sourceVideoUrl = existingUrl;
        } else if (item.driveFileId || item.stitchJobId) {
          // Server will pull from Drive / wait for stitch — no browser upload.
        } else {
          if (!item.file || item.file.size === 0) {
            throw new Error("Missing video file for upload.");
          }
          const url = await uploadFileToBunnyStorage(item.file, {
            filename: item.file.name || `${item.id}.mp4`,
            contentType: item.file.type || "video/mp4",
          });
          if (!url) {
            throw new Error(
              "Could not upload source video to storage for background processing.",
            );
          }
          sourceVideoUrl = url;
          setQueueResults((qr) => {
            const cur = qr[item.id];
            const base: QueueCarouselSnapshot =
              cur ??
              ({
                recommendation: null,
                effectiveType: null,
                editableSlides: [],
                transcript: [],
                durationSec: null,
                zipBase64: null,
                firstSlidePreviewBase64: null,
                slidePreviewBase64s: null,
                socialCaption: "",
                layoutId: PROCESS_DEFAULTS.layoutId,
                carouselOverride: PROCESS_DEFAULTS.carouselOverride,
                backgroundSource: PROCESS_DEFAULTS.backgroundSource,
                backgroundFile: null,
                imagePost: null,
                imagePostError: null,
                socialMicro: null,
                socialMicroError: null,
                processTiming: null,
                frameColorAdjust: PROCESS_DEFAULTS.frameColorAdjust,
              } as QueueCarouselSnapshot);
            const next = {
              ...qr,
              [item.id]: {
                ...base,
                bunnyUrls: {
                  ...(base.bunnyUrls ?? {}),
                  sourceVideoUrl: url,
                },
              },
            };
            queueResultsRef.current = next;
            return next;
          });
        }

        patchItem({
          progress: existingUrl
            ? "Re-queueing existing source on server…"
            : item.driveFileId || item.stitchJobId
              ? "Queueing server job…"
              : "Starting background job…",
        });
        const created = await createMultiplierProcessingJob({
          queueItemId: item.id,
          videoLabel: item.displayLabel?.trim() || item.file.name,
          ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
          ...(item.driveFileId ? { driveFileId: item.driveFileId } : {}),
          ...(item.stitchJobId ? { stitchJobId: item.stitchJobId } : {}),
          ...(item.aiInstructions
            ? { aiInstructions: item.aiInstructions }
            : {}),
          outputsWanted: {
            carousel: formats.carousel,
            photo: formats.imagePost,
            short: formats.reelShort,
            ...(formats.xPost ? { xPost: true } : {}),
          },
          studioSettings: {
            layoutId: PROCESS_DEFAULTS.layoutId,
            carouselOverride: PROCESS_DEFAULTS.carouselOverride || undefined,
            frameColorAdjust: PROCESS_DEFAULTS.frameColorAdjust,
          },
        });
        if (!created.ok) {
          throw new Error(created.message);
        }
        patchItem({
          status: "processing",
          progress: "Queued on server…",
          processingJobId: created.jobId,
          durableProcessing: true,
        });
        void kickMultiplierProcessingDue();
      } catch (e) {
        console.warn("[multiplier] durable enqueue failed:", e);
        patchItem({
          status: "error",
          progress: undefined,
          durableProcessing: false,
          processingJobId: null,
          error: sanitizeQueueErrorMessage(
            e instanceof Error
              ? e.message
              : "Could not start background job. Refresh to retry.",
          ),
        });
      }
    },
    [],
  );

  const drainDurableEnqueue = useCallback(() => {
    while (durableEnqueueInFlightRef.current < DURABLE_UPLOAD_CONCURRENCY) {
      const next = queueRef.current.find((q) => {
        if (
          q.status !== "pending" ||
          q.durableProcessing !== true ||
          q.processingJobId
        ) {
          return false;
        }
        if (q.file.size > 0 || Boolean(q.driveFileId) || Boolean(q.stitchJobId))
          return true;
        return Boolean(storedSourceVideoUrl(q.id, queueResultsRef.current));
      });
      if (!next) break;
      // Claim immediately (sync on queueRef) so the while-loop can't re-pick.
      durableEnqueueInFlightRef.current += 1;
      const claimed: VideoQueueItem = {
        ...next,
        status: "processing",
        progress: "Preparing background job…",
      };
      queueRef.current = queueRef.current.map((q) =>
        q.id === next.id ? claimed : q,
      );
      setQueue(queueRef.current);
      void enqueueDurableJobForItem(claimed).finally(() => {
        durableEnqueueInFlightRef.current -= 1;
        drainDurableEnqueue();
      });
    }
  }, [enqueueDurableJobForItem]);

  const processQueueLoop = useCallback(async () => {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    try {
      recoverStaleProcessingRows();
      for (;;) {
        const pending = queueRef.current.find(
          (q) =>
            q.status === "pending" &&
            !q.durableProcessing &&
            !q.processingJobId,
        );
        if (!pending) break;

        const formats = withEffectiveStudioOutputs(studioOutputsRef.current);
        const needsTranscript =
          formats.carousel || formats.imagePost || formats.xPost;
        const mobileSequential = isMobileClient();
        const startProgress = mobileSequential
          ? needsTranscript
            ? "Transcribing audio…"
            : formats.carousel || formats.imagePost || formats.xPost
              ? "Generating carousel…"
              : formats.reelShort
                ? "Video to Short…"
                : "Processing…"
          : formats.reelShort && needsTranscript
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

        queueProcessAbortRef.current?.abort();
        const abortController = new AbortController();
        queueProcessAbortRef.current = abortController;
        const { signal } = abortController;

        const assertQueueItemActive = () => {
          if (!queueRef.current.some((q) => q.id === pending.id)) {
            throw new QueueItemRemovedError();
          }
        };

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
          const setItemProgress = (msg: string) => {
            assertQueueItemActive();
            setQueue((prev) =>
              prev.map((q) =>
                q.id === pending.id ? { ...q, progress: msg } : q
              )
            );
            queueRef.current = queueRef.current.map((q) =>
              q.id === pending.id ? { ...q, progress: msg } : q
            );
          };
          const passthroughShort = {
            outputFile: pending.file,
            jobId: null,
            outputRevision: 0,
            editorialSummary: null,
            editorialSkip: null,
            editorialCuts: null,
          } as const;

          let shortResult: Awaited<
            ReturnType<typeof runVideoToShortIfEnabled>
          >;
          let snapBase: QueueCarouselSnapshot;
          let shortError: string | undefined;

          // Drive items: create the from-drive Short job FIRST. The create
          // returns within seconds (the backend downloads from Drive in the
          // background) and its jobId doubles as `sourceJobId`, letting
          // transcribe/carousel/image post reuse the job's downloaded source
          // instead of pulling the file from Drive three more times.
          let driveSourceJobId: string | undefined;
          let driveShortDisabled = false;
          let driveCreateError: string | undefined;
          if (pending.driveFileId && formats.reelShort) {
            setItemProgress("Starting server-side Drive ingest…");
            try {
              const created = await createShortJobFromDrive(
                pending.driveFileId,
                pending.file,
                shortTextOpts,
                { signal }
              );
              if (created) driveSourceJobId = created.jobId;
              else driveShortDisabled = true;
            } catch (e) {
              if (signal.aborted) throw e;
              driveCreateError =
                e instanceof Error
                  ? e.message
                  : "Video to Short create failed.";
            }
            assertQueueItemActive();
          }

          if (mobileSequential) {
            let sharedTranscript: QueueCarouselSnapshot["transcript"] = [];
            if (needsTranscript) {
              setItemProgress("Transcribing audio…");
              sharedTranscript = await postVideoTranscript(pending.file, signal, {
                driveFileId: pending.driveFileId,
                sourceJobId: driveSourceJobId,
              });
              assertQueueItemActive();
            }

            snapBase =
              formats.carousel || formats.imagePost || formats.xPost
                ? await postCarouselAndImagePost(
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
                      onProgress: setItemProgress,
                      signal,
                      serializeUploads: true,
                      driveFileId: pending.driveFileId,
                      sourceJobId: driveSourceJobId,
                    },
                    backgroundInputRef
                  )
                : buildSkippedCarouselSnapshot(sharedTranscript, {
                    layoutId: PROCESS_DEFAULTS.layoutId,
                    carouselOverride: PROCESS_DEFAULTS.carouselOverride,
                    backgroundSource: PROCESS_DEFAULTS.backgroundSource,
                    backgroundFile: null,
                    frameColorAdjust: PROCESS_DEFAULTS.frameColorAdjust,
                  });
            assertQueueItemActive();

            shortResult = passthroughShort;
            if (formats.reelShort) {
              try {
                setItemProgress("Video to Short…");
                if (pending.driveFileId) {
                  if (driveSourceJobId) {
                    shortResult = await resumeShortJobOutput(
                      driveSourceJobId,
                      pending.file,
                      setItemProgress,
                      { signal }
                    );
                  } else if (!driveShortDisabled) {
                    throw new Error(
                      driveCreateError ?? "Video to Short create failed."
                    );
                  }
                } else {
                  shortResult = await runVideoToShortIfEnabled(
                    pending.file,
                    setItemProgress,
                    shortTextOpts,
                    { signal }
                  );
                }
                if (!shortResult.jobId) {
                  shortError =
                    "Reel was skipped (Video to Short is off or unreachable). Carousel and image post used your original upload.";
                }
              } catch (e) {
                const inflight = readInFlightShortJob();
                if (inflight?.jobId) {
                  shortResult = {
                    outputFile: pending.file,
                    jobId: inflight.jobId,
                    outputRevision: 0,
                    editorialSummary: null,
                    editorialSkip: null,
                    editorialCuts: null,
                  };
                  shortError =
                    "Reel is still processing on the server (this tab lost connection). Keep Safari open — we'll load it automatically when ready.";
                } else {
                  shortError =
                    e instanceof Error
                      ? e.message
                      : "Video to Short failed.";
                }
              }
              assertQueueItemActive();
            }
          } else {
            // Drive create failed outright (not "disabled"): fail the item
            // now instead of leaking an already-rejected promise into the
            // parallel block (which would log an unhandled rejection).
            if (
              pending.driveFileId &&
              formats.reelShort &&
              !driveSourceJobId &&
              !driveShortDisabled
            ) {
              throw new Error(
                driveCreateError ?? "Video to Short create failed."
              );
            }

            const shortP = formats.reelShort
              ? pending.driveFileId
                ? driveSourceJobId
                  ? resumeShortJobOutput(
                      driveSourceJobId,
                      pending.file,
                      setItemProgress,
                      { signal }
                    )
                  : Promise.resolve(passthroughShort)
                : runVideoToShortIfEnabled(
                    pending.file,
                    setItemProgress,
                    shortTextOpts,
                    { signal }
                  )
              : Promise.resolve(passthroughShort);

            let sharedTranscript: QueueCarouselSnapshot["transcript"] = [];
            if (needsTranscript) {
              sharedTranscript = await postVideoTranscript(pending.file, signal, {
                driveFileId: pending.driveFileId,
                sourceJobId: driveSourceJobId,
              });
              assertQueueItemActive();
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
                      onProgress: setItemProgress,
                      signal,
                      driveFileId: pending.driveFileId,
                      sourceJobId: driveSourceJobId,
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
            [shortResult, snapBase] = await Promise.all([
              shortP,
              carouselImageP,
            ]);
            assertQueueItemActive();
          }
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
          const shortEditorialSummary = shortResult.editorialSummary ?? null;
          const shortEditorialSkip = shortResult.editorialSkip ?? null;
          const shortEditorialCuts = shortResult.editorialCuts ?? null;
          const shortErrorStored = shortError;
          const expectedShortName = getShortOutputFileName(pending.file.name);
          /** Don't attach the original upload as the Short preview while a job is still pending. */
          const shortOutputFileStored =
            shortDeliverable ??
            (shortJobIdStored &&
            !shortErrorStored &&
            shortFile.name === expectedShortName
              ? shortFile
              : undefined);
          const wasDone =
            queueRef.current.find((q) => q.id === pending.id)?.status === "done";
          if (!wasDone) incrementVideosMultiplied();
          const doneOutputs: MultiplierOutputsState = {
            carousel: formats.carousel
              ? {
                  status: "done",
                  readyToSchedule: false,
                }
              : { status: "skipped", readyToSchedule: false },
            photo: formats.imagePost
              ? {
                  status: snapBase.imagePost ? "done" : "failed",
                  readyToSchedule: false,
                  ...(snapBase.imagePostError
                    ? { error: snapBase.imagePostError }
                    : {}),
              }
              : { status: "skipped", readyToSchedule: false },
            short: formats.reelShort
              ? shortErrorStored && !shortJobIdStored && !shortOutputFileStored
                ? {
                    status: "failed",
                    readyToSchedule: false,
                    error: shortErrorStored,
                  }
                : {
                    status: "done",
                    readyToSchedule: false,
                    ...(shortErrorStored ? { error: shortErrorStored } : {}),
                  }
              : { status: "skipped", readyToSchedule: false },
          };
          const doneQueuePatch = {
            status: "done" as const,
            progress: undefined,
            shortOutputFile: shortOutputFileStored,
            shortJobId: shortJobIdStored,
            shortOutputRevision: shortResult.outputRevision,
            shortEditorialSummary,
            shortEditorialSkip,
            shortEditorialCuts,
            durableProcessing: false,
            outputs: doneOutputs,
            ...(shortErrorStored
              ? { shortError: shortErrorStored }
              : { shortError: undefined }),
            ...(!wasDone
              ? {
                  studioContentBaseline: studioContentFingerprint(
                    { shortOutputRevision: shortResult.outputRevision },
                    snap
                  ),
                }
              : {}),
          };
          setQueue((prev) =>
            prev.map((q) =>
              q.id === pending.id
                ? {
                    ...q,
                    ...doneQueuePatch,
                  }
                : q
            )
          );
          queueRef.current = queueRef.current.map((q) =>
            q.id === pending.id
              ? {
                  ...q,
                  ...doneQueuePatch,
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
          if (isQueueProcessingAbort(e)) {
            continue;
          }
          if (!queueRef.current.some((q) => q.id === pending.id)) {
            continue;
          }
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
          if (queueProcessAbortRef.current === abortController) {
            queueProcessAbortRef.current = null;
          }
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
      const stillActive = queueRef.current.some(
        (q) => q.status === "pending" || q.status === "processing"
      );
      if (!stillActive) {
        setLoading(false);
      }
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
  }, [applySnapshot, recoverStaleProcessingRows]);

  useEffect(() => {
    processQueueLoopRef.current = () => {
      void processQueueLoop();
    };
  }, [processQueueLoop]);

  useEffect(() => {
    recoverStaleProcessingRows();
    if (
      queueRef.current.some(
        (q) =>
          q.status === "pending" &&
          !q.durableProcessing &&
          !q.processingJobId,
      )
    ) {
      void processQueueLoop();
    }
  }, [processQueueLoop, recoverStaleProcessingRows]);

  // Hydration / new uploads can add durable-pending rows after mount — drain
  // whenever the queue gains them (do not run recoverStale here; that would
  // bounce in-flight browser jobs back to Waiting on every setQueue).
  useEffect(() => {
    if (
      queue.some(
        (q) =>
          q.status === "pending" &&
          q.durableProcessing === true &&
          !q.processingJobId,
      )
    ) {
      drainDurableEnqueue();
    }
  }, [queue, drainDurableEnqueue]);

  const enqueueFiles = useCallback(
    (
      files: File[],
      opts?: {
        aiInstructionsByIndex?: Array<string | undefined>;
        /** Drive inbox ids for server-side ingest (parallel to `files`). */
        driveFileIdsByIndex?: Array<string | undefined>;
        /** Stitch job ids for server-side ingest (parallel to `files`). */
        stitchJobIdsByIndex?: Array<string | undefined>;
      }
    ) => {
      const list = files.filter(isLikelyVideoFile);
      if (list.length === 0) {
        if (files.length > 0) {
          setError(
            "None of the selected files look like supported videos (e.g. .mp4, .mov, .webm). If this is a video, try renaming with a standard extension or export as MP4."
          );
        }
        return [];
      }
      const o = withEffectiveStudioOutputs(studioOutputsRef.current);
      if (!o.carousel && !o.imagePost && !o.xPost && !o.reelShort) {
        setError("Choose at least one output format before uploading.");
        return [];
      }
      setError(null);
      const notesByIndex = opts?.aiInstructionsByIndex ?? [];
      const driveIdsByIndex = opts?.driveFileIdsByIndex ?? [];
      const stitchIdsByIndex = opts?.stitchJobIdsByIndex ?? [];
      const takenNames = new Set(
        queueRef.current.map((q) => q.file.name.trim().toLowerCase()),
      );
      const uniqueList: File[] = [];
      const uniqueNotes: Array<string | undefined> = [];
      const uniqueDriveIds: Array<string | undefined> = [];
      const uniqueStitchIds: Array<string | undefined> = [];
      list.forEach((f, idx) => {
        const n = f.name.trim().toLowerCase();
        if (!n || takenNames.has(n)) return;
        takenNames.add(n);
        uniqueList.push(f);
        uniqueNotes.push(notesByIndex[idx]);
        uniqueDriveIds.push(driveIdsByIndex[idx]);
        uniqueStitchIds.push(stitchIdsByIndex[idx]);
      });
      if (uniqueList.length === 0) return [];
      const newItems: VideoQueueItem[] = uniqueList.map((f, idx) => ({
        id: crypto.randomUUID(),
        file: f,
        driveFileId:
          typeof uniqueDriveIds[idx] === "string" &&
          uniqueDriveIds[idx]!.trim().length > 0
            ? uniqueDriveIds[idx]!.trim()
            : undefined,
        stitchJobId:
          typeof uniqueStitchIds[idx] === "string" &&
          uniqueStitchIds[idx]!.trim().length > 0
            ? uniqueStitchIds[idx]!.trim()
            : undefined,
        aiInstructions:
          typeof uniqueNotes[idx] === "string"
            ? uniqueNotes[idx]!.trim().slice(0, MAX_CAROUSEL_FOCUS_CHARS)
            : undefined,
        status: "pending" as const,
        // Prefer durable server jobs so tab close does not kill the batch.
        durableProcessing: true,
      }));
      // Update ref synchronously before drain — React may apply setQueue later.
      const next = [...queueRef.current, ...newItems];
      queueRef.current = next;
      setQueue(next);
      // Always focus the new upload so the UI does not stay on a previous queue item
      // (prev ?? newId kept the old selection and felt like "nothing happened").
      selectQueueItem(newItems[0]!.id);
      // Do not set global `loading` — keep Add unlocked while server jobs run.
      drainDurableEnqueue();
      return newItems.map((item) => item.id);
    },
    [drainDurableEnqueue, selectQueueItem, setError]
  );

  const file = useMemo(() => {
    if (!activeQueueId) return null;
    return queue.find((q) => q.id === activeQueueId)?.file ?? null;
  }, [queue, activeQueueId]);

  const canReRenderZip = useMemo(() => {
    if (!activeQueueId || editableSlides.length === 0 || transcript.length === 0) {
      return false;
    }
    const activeRow = queue.find((q) => q.id === activeQueueId);
    const sourceVideoUrl = storedSourceVideoUrl(activeQueueId, queueResults);
    return hasCarouselVideoSource({
      videoFile: activeRow?.file ?? null,
      driveFileId: activeRow?.driveFileId,
      sourceVideoUrl,
    });
  }, [activeQueueId, editableSlides.length, queue, queueResults, transcript.length]);

  const canRegenerateImagePostCopy = useMemo(() => {
    if (!activeQueueId || transcript.length === 0) return false;
    const activeRow = queue.find((q) => q.id === activeQueueId);
    const sourceVideoUrl = storedSourceVideoUrl(activeQueueId, queueResults);
    return hasCarouselVideoSource({
      videoFile: activeRow?.file ?? null,
      driveFileId: activeRow?.driveFileId,
      sourceVideoUrl,
    });
  }, [activeQueueId, queue, queueResults, transcript.length]);

  const canRerenderImagePostOverlay = useMemo(() => {
    if (!canRegenerateImagePostCopy || !imagePost) return false;
    const frameTime = imagePost.frameTimeSec;
    return frameTime !== undefined && Number.isFinite(frameTime);
  }, [canRegenerateImagePostCopy, imagePost]);

  const shortOutputFile = useMemo(() => {
    if (!activeQueueId) return null;
    const row = queue.find((q) => q.id === activeQueueId);
    if (!row || !hasUsableShortOutput(row)) return null;
    return row.shortOutputFile ?? null;
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

  const shortError = useMemo(() => {
    if (!activeQueueId) return null;
    const v = queue.find((q) => q.id === activeQueueId)?.shortError;
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  }, [queue, activeQueueId]);

  const shortOutputRevision = useMemo(() => {
    if (!activeQueueId) return 0;
    const rev = queue.find((q) => q.id === activeQueueId)?.shortOutputRevision;
    return typeof rev === "number" && Number.isFinite(rev) && rev >= 0
      ? Math.floor(rev)
      : 0;
  }, [queue, activeQueueId]);

  const reelMp4Url = useMemo(() => {
    if (!activeQueueId) return null;
    const url = queueResults[activeQueueId]?.bunnyUrls?.reelMp4Url;
    return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
  }, [queueResults, activeQueueId]);

  const applyShortToQueueItem = useCallback(
    (
      queueId: string,
      file: File,
      extras?: {
        editorialSummary?: string | null;
        editorialSkip?: string | null;
        editorialCuts?: unknown | null;
        outputRevision?: number;
      }
    ) => {
      const patch = (q: VideoQueueItem): VideoQueueItem =>
        q.id === queueId
          ? {
              ...q,
              shortOutputFile: file,
              shortError: undefined,
              progress: undefined,
              ...(extras?.editorialSummary !== undefined
                ? { shortEditorialSummary: extras.editorialSummary }
                : {}),
              ...(extras?.editorialSkip !== undefined
                ? { shortEditorialSkip: extras.editorialSkip }
                : {}),
              ...(extras?.editorialCuts !== undefined
                ? { shortEditorialCuts: extras.editorialCuts }
                : {}),
              ...(extras?.outputRevision !== undefined
                ? { shortOutputRevision: extras.outputRevision }
                : {}),
            }
          : q;
      setQueue((prev) => {
        const next = prev.map(patch);
        queueRef.current = next;
        return next;
      });
      shortResumeAttemptRef.current.delete(queueId);
      shortResumeGiveUpRef.current.delete(queueId);
    },
    []
  );

  const clearStoredReelMp4Url = useCallback((queueId: string) => {
    setQueueResults((qr) => {
      const cur = qr[queueId];
      if (!cur?.bunnyUrls?.reelMp4Url) return qr;
      const { reelMp4Url: _removed, ...restBunny } = cur.bunnyUrls;
      const bunnyUrls =
        Object.keys(restBunny).length > 0 ? restBunny : undefined;
      const next = {
        ...qr,
        [queueId]: { ...cur, bunnyUrls },
      };
      queueResultsRef.current = next;
      return next;
    });
  }, []);

  const resumeShortForQueueItem = useCallback(
    async (queueId: string) => {
      if (shortResumeInFlightRef.current.has(queueId)) return;
      const row = queueRef.current.find((q) => q.id === queueId);
      if (!row || row.status !== "done") return;
      const jobId =
        typeof row.shortJobId === "string" && row.shortJobId.trim()
          ? row.shortJobId.trim()
          : null;
      if (!jobId) return;
      if (hasUsableShortOutput(row)) return;
      if (shortJobPollLockRef.current.has(jobId)) return;

      shortResumeInFlightRef.current.add(queueId);
      shortJobPollLockRef.current.add(jobId);
      const isActive = activeQueueIdRef.current === queueId;
      if (isActive) {
        setShortResumeBusy(true);
        setShortResumeMessage("Resuming reel…");
      }

      const outputName = getShortOutputFileName(row.file.name || "video.mp4");
      const onProgress = (msg: string) => {
        if (activeQueueIdRef.current === queueId) {
          setShortResumeMessage(msg);
        }
        setQueue((prev) => {
          const next = prev.map((q) =>
            q.id === queueId ? { ...q, progress: msg } : q
          );
          queueRef.current = next;
          return next;
        });
      };

      try {
        const snap = queueResultsRef.current[queueId];
        const reelUrl = snap?.bunnyUrls?.reelMp4Url?.trim();

        // While reprocessing this session, prefer the Short backend (freshest).
        // Otherwise prefer Bunny — job download URLs expire after days/redeploys.
        const preferBackend = Boolean(
          row.shortOutputRevision && row.shortOutputRevision > 0 && !reelUrl
        );

        if (!preferBackend && reelUrl) {
          const res = await fetch(reelUrl, { cache: "no-store" });
          if (res.ok) {
            const bytes = await res.arrayBuffer();
            if (bytes.byteLength > 0) {
              applyShortToQueueItem(
                queueId,
                new File([bytes], outputName, { type: "video/mp4" })
              );
              clearInFlightShortJob();
              return;
            }
          }
        }

        try {
          const file = await downloadCompletedShortFile(jobId, outputName);
          const state = await fetchJobPollState(jobId);
          applyShortToQueueItem(queueId, file, {
            outputRevision: pickOutputRevisionFromJobPoll(
              state as Record<string, unknown>
            ),
            ...editorialFieldsFromJobPoll(state),
          });
          clearInFlightShortJob();
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          // Fall through to Bunny / poll when backend is gone or still encoding.
          if (reelUrl) {
            const res = await fetch(reelUrl, { cache: "no-store" });
            if (res.ok) {
              const bytes = await res.arrayBuffer();
              if (bytes.byteLength > 0) {
                applyShortToQueueItem(
                  queueId,
                  new File([bytes], outputName, { type: "video/mp4" })
                );
                clearInFlightShortJob();
                return;
              }
            }
          }
          if (!msg.toLowerCase().includes("still")) throw e;
        }

        const { file, finalState } = await pollVideoToShortJobUntilFile(
          jobId,
          outputName,
          onProgress
        );
        applyShortToQueueItem(queueId, file, {
          outputRevision: pickOutputRevisionFromJobPoll(
            finalState as Record<string, unknown>
          ),
          ...editorialFieldsFromJobPoll(finalState),
        });
        clearInFlightShortJob();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Video to Short failed.";
        const attempts = (shortResumeAttemptRef.current.get(queueId) ?? 0) + 1;
        shortResumeAttemptRef.current.set(queueId, attempts);
        if (isTerminalShortResumeError(msg) || attempts >= 8) {
          shortResumeGiveUpRef.current.add(queueId);
        }
        setQueue((prev) => {
          const next = prev.map((q) =>
            q.id === queueId ? { ...q, shortError: msg, progress: undefined } : q
          );
          queueRef.current = next;
          return next;
        });
      } finally {
        shortResumeInFlightRef.current.delete(queueId);
        shortJobPollLockRef.current.delete(jobId);
        if (activeQueueIdRef.current === queueId) {
          setShortResumeBusy(false);
          setShortResumeMessage(null);
        }
      }
    },
    [applyShortToQueueItem]
  );

  const attachRecoveredShortFile = useCallback(
    (sourceName: string, file: File) => {
      const match = [...queueRef.current]
        .reverse()
        .find(
          (q) => q.status === "done" && queueItemMatchesSourceName(q, sourceName)
        );
      if (!match) return;
      shortResumeGiveUpRef.current.delete(match.id);
      applyShortToQueueItem(match.id, file);
      clearInFlightShortJob();
    },
    [applyShortToQueueItem]
  );

  const recoverInFlightShortForQueue = useCallback(
    async (record: InFlightShortJob) => {
      if (shortJobPollLockRef.current.has(record.jobId)) {
        throw new Error("Reel is already loading — please wait.");
      }
      shortJobPollLockRef.current.add(record.jobId);
      try {
        const file = await recoverInFlightShortJob(record);
        attachRecoveredShortFile(record.sourceName, file);
      } finally {
        shortJobPollLockRef.current.delete(record.jobId);
      }
    },
    [attachRecoveredShortFile]
  );

  useEffect(() => {
    setQueue((prev) => {
      let changed = false;
      const next = prev.map((q) => {
        if (hasUsableShortOutput(q) && q.shortError) {
          changed = true;
          return { ...q, shortError: undefined };
        }
        if (
          q.shortOutputFile &&
          q.shortJobId?.trim() &&
          !hasUsableShortOutput(q)
        ) {
          changed = true;
          return { ...q, shortOutputFile: undefined };
        }
        return q;
      });
      if (changed) queueRef.current = next;
      return changed ? next : prev;
    });

    const inflight = readInFlightShortJob();
    if (inflight?.jobId) {
      setQueue((prev) => {
        let changed = false;
        const next = prev.map((q) => {
          if (q.status !== "done") return q;
          if (!queueItemMatchesSourceName(q, inflight.sourceName)) return q;
          if (hasUsableShortOutput(q)) return q;
          if (q.shortJobId === inflight.jobId) return q;
          changed = true;
          return {
            ...q,
            shortJobId: inflight.jobId,
            shortOutputFile: undefined,
            shortError:
              q.shortError ??
              "Reel is still processing on the server (this tab lost connection). Keep Safari open — we'll load it automatically when ready.",
          };
        });
        if (changed) queueRef.current = next;
        return changed ? next : prev;
      });
    }

    for (const q of queue) {
      const hasBunnyReel = Boolean(
        queueResults[q.id]?.bunnyUrls?.reelMp4Url?.trim(),
      );
      if (!shouldAutoResumeShort(q, shortResumeGiveUpRef.current, hasBunnyReel))
        continue;
      void resumeShortForQueueItem(q.id);
    }
  }, [queue, queueResults, resumeShortForQueueItem]);

  // Completed jobs store editorial on `meta`; older studio builds missed it at poll time.
  useEffect(() => {
    const aid = activeQueueId;
    const jobId = shortJobId;
    if (!aid || !jobId) return;
    if (shortEditorialHydratedRef.current.has(jobId)) return;

    const row = queueRef.current.find((q) => q.id === aid);
    if (!row || row.status !== "done") return;

    const ensureShortFile = () => {
      const latest = queueRef.current.find((q) => q.id === aid);
      if (latest && !hasUsableShortOutput(latest)) {
        void resumeShortForQueueItem(aid);
      }
    };

    if (hasShortEditorialMetadata(row)) {
      shortEditorialHydratedRef.current.add(jobId);
      ensureShortFile();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const state = await fetchJobPollState(jobId);
        if (cancelled) return;
        if (state.status !== "completed") {
          ensureShortFile();
          return;
        }
        const fields = editorialFieldsFromJobPoll(state);
        const hasAny =
          Boolean(fields.editorialSummary) ||
          Boolean(fields.editorialSkip) ||
          (fields.editorialCuts !== undefined && fields.editorialCuts !== null);
        if (hasAny) {
          shortEditorialHydratedRef.current.add(jobId);
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
        }
        ensureShortFile();
      } catch {
        ensureShortFile();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeQueueId, shortJobId, resumeShortForQueueItem]);

  const reprocessActiveShortOutput = useCallback(
    async (text: StudioShortTextOptions) => {
      const aid = activeQueueIdRef.current;
      if (!aid) {
        setError("No active video.");
        return false;
      }
      if (shortReprocessInFlightRef.current) {
        setError("A re-process is already running for this reel.");
        return false;
      }
      const row = queueRef.current.find((q) => q.id === aid);
      if (!row?.shortJobId) {
        setError(
          "Short re-process needs a job from this session. Re-upload the video to enable editing."
        );
        return false;
      }
      if (shortJobPollLockRef.current.has(row.shortJobId)) {
        setError("Short job is busy — wait for the current operation to finish.");
        return false;
      }
      shortReprocessInFlightRef.current = true;
      shortJobPollLockRef.current.add(row.shortJobId);
      setShortReprocessBusy(true);
      setShortReprocessProgress(null);
      setError(null);
      setQueue((prev) =>
        prev.map((q) =>
          q.id === aid ? { ...q, shortOutputFile: undefined } : q
        )
      );
      queueRef.current = queueRef.current.map((q) =>
        q.id === aid ? { ...q, shortOutputFile: undefined } : q
      );
      try {
        const shortRun = await reprocessVideoToShortJob(
          row.shortJobId,
          text,
          getShortOutputFileName(row.file.name),
          (message) => setShortReprocessProgress(message)
        );
        shortEditorialHydratedRef.current.add(row.shortJobId);
        clearStoredReelMp4Url(aid);
        setQueue((prev) =>
          prev.map((q) =>
            q.id === aid
              ? {
                  ...q,
                  shortOutputFile: shortRun.outputFile,
                  shortError: undefined,
                  shortOutputRevision: shortRun.outputRevision,
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
                shortError: undefined,
                shortOutputRevision: shortRun.outputRevision,
                shortEditorialSummary: shortRun.editorialSummary ?? null,
                shortEditorialSkip: shortRun.editorialSkip ?? null,
                shortEditorialCuts: shortRun.editorialCuts ?? null,
              }
            : q
        );
        return true;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Short re-process failed."
        );
        return false;
      } finally {
        shortReprocessInFlightRef.current = false;
        const jid = queueRef.current.find((q) => q.id === aid)?.shortJobId;
        if (jid) shortJobPollLockRef.current.delete(jid);
        setShortReprocessBusy(false);
        setShortReprocessProgress(null);
      }
    },
    [clearStoredReelMp4Url]
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
      const activeRow = aid
        ? queueRef.current.find((q) => q.id === aid)
        : undefined;
      const videoFile = activeRow?.file ?? null;
      const rerunDriveFileId = activeRow?.driveFileId;
      const sourceVideoUrl = storedSourceVideoUrl(
        aid,
        queueResultsRef.current
      );
      if (
        !aid ||
        !hasCarouselVideoSource({
          videoFile,
          driveFileId: rerunDriveFileId,
          sourceVideoUrl,
        })
      ) {
        setError(
          videoFile && videoFile.size === 0 && !sourceVideoUrl && !rerunDriveFileId
            ? "Source video isn't available on this device (was processed on another session). Re-upload the original video to regenerate."
            : "Choose a video file."
        );
        return;
      }

      const out = withEffectiveStudioOutputs(studioOutputsRef.current);
      if (!out.carousel && !out.imagePost && !out.xPost) {
        setError(
          X_THREADS_OUTPUT_ENABLED
            ? "Enable at least one of Carousel, Image post, or X/Threads to regenerate."
            : "Enable at least one of Carousel or Image post to regenerate."
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
        const normalizedTranscript = normalizeTranscriptSegments(transcript);
        const canReuseTranscript =
          !defaultsOnly && normalizedTranscript !== null;
        const snap = await postCarouselAndImagePost(
          videoFile ?? activeRow!.file,
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
            existingTranscript: normalizedTranscript ?? undefined,
            driveFileId: rerunDriveFileId,
            sourceJobId:
              (rerunDriveFileId ? activeRow?.shortJobId : null) ?? undefined,
            sourceVideoUrl,
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
        editableSlidesRef.current = next;
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
      editableSlidesRef.current = next;
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
      editableSlidesRef.current = next;
      carouselTextBaselineForLearningRef.current =
        cloneSlidesForLearningBaseline(next);
      return next;
    });
  }, []);

  const moveSlide = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setEditableSlides((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const next = moveArrayItem(prev, fromIndex, toIndex).map((s, i) => ({
        ...s,
        order: i + 1,
      }));
      editableSlidesRef.current = next;
      carouselTextBaselineForLearningRef.current =
        cloneSlidesForLearningBaseline(next);
      return next;
    });
    setSlidePreviewBase64s((prev) => {
      if (!prev) return prev;
      const next = moveArrayItem(prev, fromIndex, toIndex);
      setFirstSlidePreviewBase64(next.length > 0 ? next[0] : null);
      return next;
    });
    setSlidePreviewBase64sInstagram((prev) => {
      if (!prev) return prev;
      return moveArrayItem(prev, fromIndex, toIndex);
    });
  }, []);

  const reRenderZip = useCallback(async () => {
    if (reRenderInFlightRef.current) return;
    const failReRender = (message: string) => {
      setError(message);
      setReRenderError(message);
    };
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement
    ) {
      active.blur();
    }
    // Finish any in-flight controlled-input updates before reading slide copy.
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    setError(null);
    setReRenderError(null);
    const aid = activeQueueIdRef.current;
    const activeRow = aid
      ? queueRef.current.find((q) => q.id === aid)
      : undefined;
    const videoFile = activeRow?.file ?? null;
    const driveFileId = activeRow?.driveFileId;
    const driveSourceJobId =
      (driveFileId ? activeRow?.shortJobId : null) ?? undefined;
    const slidesForRender = editableSlidesRef.current;
    const transcriptForRender = transcriptRef.current;
    const sourceVideoUrl = storedSourceVideoUrl(
      aid,
      queueResultsRef.current
    );
    const useServerSourceVideo =
      Boolean(sourceVideoUrl) && (!videoFile || videoFile.size === 0);
    if (
      slidesForRender.length === 0 ||
      transcriptForRender.length === 0 ||
      (!useServerSourceVideo &&
        !driveFileId &&
        (!videoFile || videoFile.size === 0))
    ) {
      failReRender(
        transcriptForRender.length === 0
          ? "Need transcript to re-render slides."
          : videoFile && videoFile.size === 0 && !sourceVideoUrl && !driveFileId
            ? "Source video isn't available on this device (was processed on another session). Re-upload the original video to re-render."
            : "Need a video file and slides to re-render.",
      );
      return;
    }
    const bgFile =
      backgroundSource === "own_background"
        ? backgroundFile ?? backgroundInputRef.current?.files?.[0] ?? null
        : null;
    if (backgroundSource === "own_background" && !backgroundFile && bgFile) {
      setBackgroundFile(bgFile);
    }
    reRenderInFlightRef.current = true;
    setReRenderLoading(true);
    setReRenderProgress(
      useServerSourceVideo
        ? "Rendering slides (server is loading your video from storage)…"
        : "Rendering slides with your text changes…"
    );
    const abortController = new AbortController();
    // Keep under /api/render maxDuration (300s) so the client aborts before the server drops.
    const renderTimeoutMs = 290_000;
    const renderTimeout = setTimeout(() => abortController.abort(), renderTimeoutMs);
    try {
      const fd = new FormData();
      appendCarouselVideoIngestFields(fd, videoFile ?? new File([], "video.mp4"), {
        driveFileId,
        sourceJobId: driveSourceJobId,
        sourceVideoUrl: useServerSourceVideo ? sourceVideoUrl : undefined,
      });
      if (backgroundSource === "own_background" && bgFile) {
        fd.append("background", bgFile);
      }
      fd.append("slides", JSON.stringify(slidesForRender));
      fd.append("transcript", JSON.stringify(transcriptForRender));
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
        signal: abortController.signal,
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        failReRender(
          res.ok
            ? "Invalid response from server."
            : `Re-render failed (${res.status}).`
        );
        return;
      }
      if (!res.ok) {
        failReRender(
          typeof data.error === "string" ? data.error : "Re-render failed"
        );
        return;
      }
      if (
        typeof data.zipBase64 !== "string" ||
        data.zipBase64.trim().length === 0
      ) {
        failReRender("Re-render finished but no slide images were returned.");
        return;
      }
      previewRenderEpochRef.current += 1;
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
          const prevBunny = prevSnap.bunnyUrls;
          const nextSlidesAssetVersion = (prevSnap.slidesAssetVersion ?? 0) + 1;
          const merged: QueueCarouselSnapshot = {
            ...prevSnap,
            zipBase64: newZip,
            firstSlidePreviewBase64: newFirst,
            slidePreviewBase64s: nextPreviews,
            slidePreviewBase64sInstagram: nextPreviewsIg,
            editableSlides: slidesForRender,
            transcript: transcriptForRender,
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
            slidesAssetVersion: nextSlidesAssetVersion,
            ...(prevBunny
              ? {
                  bunnyUrls: {
                    ...prevBunny,
                    slideUrls: [],
                    slideUrlsInstagram: [],
                  },
                }
              : {}),
          };
          const next = { ...qr, [aid]: merged };
          queueResultsRef.current = next;
          return next;
        });
      }
    } catch (err) {
      if (isQueueProcessingAbort(err)) {
        failReRender(
          "Rebuild timed out after several minutes. Try again with fewer slides or a shorter video."
        );
      } else {
        failReRender(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      clearTimeout(renderTimeout);
      reRenderInFlightRef.current = false;
      setReRenderProgress(null);
      setReRenderLoading(false);
    }
  }, [
    backgroundFile,
    backgroundSource,
    buildSnapshotFromWorkspace,
    frameColorAdjust,
    layoutId,
    socialCaption,
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
      merged[aid] = mergeWorkspaceSnapshot(merged[aid]);
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
    let nextImagePost: ImagePostSnapshot | null = null;
    setImagePost((prev) => {
      if (!prev) return prev;
      nextImagePost = { ...prev, ...patch };
      return nextImagePost;
    });
    const aid = activeQueueIdRef.current;
    if (!aid || !nextImagePost) return;
    setQueueResults((qr) => {
      const cur = qr[aid];
      if (!cur) return qr;
      const next = { ...qr, [aid]: { ...cur, imagePost: nextImagePost! } };
      queueResultsRef.current = next;
      return next;
    });
  }, []);

  const regenerateImagePostCopy = useCallback(async () => {
    const aid = activeQueueIdRef.current;
    const activeRow = aid
      ? queueRef.current.find((q) => q.id === aid)
      : undefined;
    const regenDriveFileId = activeRow?.driveFileId;
    const sourceVideoUrl = storedSourceVideoUrl(
      aid,
      queueResultsRef.current
    );
    let videoFile = activeRow?.file ?? null;
    if (
      aid &&
      videoFile &&
      videoFile.size === 0 &&
      !regenDriveFileId &&
      !sourceVideoUrl
    ) {
      videoFile = await rehydrateSourceVideoFile(aid);
    }
    if (
      !videoFile ||
      (!hasCarouselVideoSource({
        videoFile,
        driveFileId: regenDriveFileId,
        sourceVideoUrl,
      })) ||
      transcript.length === 0
    ) {
      setError(
        videoFile && videoFile.size === 0 && !sourceVideoUrl && !regenDriveFileId
          ? "Source video isn't available on this device. Re-upload the original video to regenerate image-post copy."
          : "Need a video and transcript to regenerate image post copy.",
      );
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
        driveFileId: regenDriveFileId,
        sourceJobId:
          (regenDriveFileId ? activeRow?.shortJobId : null) ?? undefined,
        sourceVideoUrl,
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
    if (!X_THREADS_OUTPUT_ENABLED) return;
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
    async (
      hook: string,
      microCta: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const aid = activeQueueIdRef.current;
      const activeRow = aid
        ? queueRef.current.find((q) => q.id === aid)
        : undefined;
      const videoFile = activeRow?.file ?? null;
      const driveFileId = activeRow?.driveFileId;
      const driveSourceJobId =
        (driveFileId ? activeRow?.shortJobId : null) ?? undefined;
      const sourceVideoUrl = storedSourceVideoUrl(
        aid,
        queueResultsRef.current
      );
      const useServerSourceVideo =
        Boolean(sourceVideoUrl) && (!videoFile || videoFile.size === 0);
      const frameTime = imagePostFrameTimeRef.current;
      const hasVideoSource = hasCarouselVideoSource({
        videoFile,
        driveFileId,
        sourceVideoUrl,
      });
      if (
        !hasVideoSource ||
        frameTime === undefined ||
        !Number.isFinite(frameTime)
      ) {
        const message =
          videoFile && videoFile.size === 0 && !sourceVideoUrl && !driveFileId
            ? "Source video isn't available on this device (was processed on another session). Re-upload the original video to update the image."
            : frameTime === undefined || !Number.isFinite(frameTime)
              ? "Need the saved frame time to update the image. Regenerate the image post once, then try again."
              : "Need the video file and frame time to update the image.";
        setError(message);
        return { ok: false, error: message };
      }
      setImagePostBusy(true);
      setError(null);
      try {
        const fd = new FormData();
        appendCarouselVideoIngestFields(
          fd,
          videoFile ?? new File([], "video.mp4"),
          {
            driveFileId,
            sourceJobId: driveSourceJobId,
            sourceVideoUrl: useServerSourceVideo ? sourceVideoUrl ?? undefined : undefined,
          }
        );
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
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not update image";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setImagePostBusy(false);
      }
    },
    []
  );

  const applyImagePostFrameColor = useCallback(async (): Promise<boolean> => {
    const aid = activeQueueIdRef.current;
    const activeRow = aid
      ? queueRef.current.find((q) => q.id === aid)
      : undefined;
    const videoFile = activeRow?.file ?? null;
    const driveFileId = activeRow?.driveFileId;
    const driveSourceJobId =
      (driveFileId ? activeRow?.shortJobId : null) ?? undefined;
    const sourceVideoUrl = storedSourceVideoUrl(
      aid,
      queueResultsRef.current
    );
    const useServerSourceVideo =
      Boolean(sourceVideoUrl) && (!videoFile || videoFile.size === 0);
    const ip = imagePost;
    const frameTime = ip?.frameTimeSec;
    const hasVideoSource = hasCarouselVideoSource({
      videoFile,
      driveFileId,
      sourceVideoUrl,
    });
    if (
      !hasVideoSource ||
      !ip ||
      frameTime === undefined ||
      !Number.isFinite(frameTime)
    ) {
      setError(
        videoFile && videoFile.size === 0 && !sourceVideoUrl && !driveFileId
          ? "Source video isn't available on this device (was processed on another session). Re-upload the original to apply frame color."
          : "Need the video file and image post to apply frame color.",
      );
      return false;
    }
    setImagePostBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      appendCarouselVideoIngestFields(
        fd,
        videoFile ?? new File([], "video.mp4"),
        {
          driveFileId,
          sourceJobId: driveSourceJobId,
          sourceVideoUrl: useServerSourceVideo ? sourceVideoUrl : undefined,
        }
      );
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

  const setOutputReadyToSchedule = useCallback(
    async (
      queueItemId: string,
      output: MultiplierOutputKey,
      ready: boolean,
    ) => {
      setQueue((prev) => {
        const next = prev.map((q) => {
          if (q.id !== queueItemId) return q;
          const outputs: MultiplierOutputsState = {
            ...(q.outputs ?? {}),
            [output]: {
              ...(q.outputs?.[output] ?? { status: "done" as const }),
              readyToSchedule: ready,
            },
          };
          return { ...q, outputs };
        });
        queueRef.current = next;
        return next;
      });
      const res = await patchMultiplierQueueItemOnHub(queueItemId, {
        payload: {
          outputs: {
            [output]: { readyToSchedule: ready },
          },
        },
      });
      if (!res.ok) {
        console.warn(
          `[multiplier-queue] readyToSchedule patch failed for ${queueItemId}:`,
          res.message,
        );
        setError(res.message);
      }
    },
    [setError],
  );

  const value = useMemo<CarouselWorkspaceValue>(
    () => ({
      queue,
      activeQueueId,
      selectQueueItem,
      removeQueueItem,
      renameQueueItem,
      enqueueFiles,
      file,
      shortOutputFile,
      shortJobId,
      shortEditorialSummary,
      shortEditorialSkip,
      shortEditorialCuts,
      shortError,
      shortOutputRevision,
      reelMp4Url,
      shortResumeBusy,
      shortResumeMessage,
      attachRecoveredShortFile,
      recoverInFlightShortForQueue,
      shortReprocessBusy,
      shortReprocessProgress,
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
      reRenderProgress,
      reRenderError,
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
      moveSlide,
      canReRenderZip,
      canRegenerateImagePostCopy,
      canRerenderImagePostOverlay,
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
      rehydrateSourceVideoFile,
      setOutputReadyToSchedule,
      hubQueueHydrationDone,
    }),
    [
      queue,
      queueResults,
      activeQueueId,
      canReRenderZip,
      canRegenerateImagePostCopy,
      canRerenderImagePostOverlay,
      selectQueueItem,
      removeQueueItem,
      renameQueueItem,
      enqueueFiles,
      file,
      shortOutputFile,
      shortJobId,
      shortEditorialSummary,
      shortEditorialSkip,
      shortEditorialCuts,
      shortError,
      shortOutputRevision,
      reelMp4Url,
      shortResumeBusy,
      shortResumeMessage,
      attachRecoveredShortFile,
      recoverInFlightShortForQueue,
      shortReprocessBusy,
      shortReprocessProgress,
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
      reRenderProgress,
      reRenderError,
      downloadAllZipsLoading,
      canDownloadAllZips,
      backgroundSource,
      backgroundFile,
      generateCarousel,
      updateSlide,
      removeSlide,
      addSlide,
      moveSlide,
      canReRenderZip,
      canRegenerateImagePostCopy,
      canRerenderImagePostOverlay,
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
      rehydrateSourceVideoFile,
      setOutputReadyToSchedule,
      hubQueueHydrationDone,
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
