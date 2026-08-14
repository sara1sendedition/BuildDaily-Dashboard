import type { MultiplierOutputsState } from "@/lib/multiplier-queue/output-state";

export const MULTIPLIER_JOB_TYPE = "multiplier_outputs" as const;

export const DEFAULT_MULTIPLIER_MAX_ATTEMPTS = 3;

/** Stored in ProcessingJob.payload for durable Multiplier runs. */
export type MultiplierProcessingJobPayload = {
  v: 1;
  queueItemId: string;
  videoLabel: string;
  sourceVideoUrl?: string;
  driveFileId?: string;
  /** Video-to-Short stitch job; worker waits for it and downloads the MP4. */
  stitchJobId?: string;
  aiInstructions?: string;
  outputsWanted: {
    carousel: boolean;
    photo: boolean;
    short: boolean;
    xPost?: boolean;
  };
  studioSettings?: {
    layoutId?: string;
    carouselOverride?: string;
    frameColorAdjust?: unknown;
  };
  /** Mirrors queue payload outputs for progress reporting. */
  outputs?: MultiplierOutputsState;
};

export function parseMultiplierJobPayload(
  raw: unknown,
): MultiplierProcessingJobPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const queueItemId =
    typeof o.queueItemId === "string" ? o.queueItemId.trim() : "";
  const videoLabel =
    typeof o.videoLabel === "string" ? o.videoLabel.trim() : "";
  if (!queueItemId || !videoLabel) return null;
  const wanted = o.outputsWanted;
  if (!wanted || typeof wanted !== "object") return null;
  const w = wanted as Record<string, unknown>;
  return {
    v: 1,
    queueItemId,
    videoLabel,
    ...(typeof o.sourceVideoUrl === "string" && o.sourceVideoUrl.trim()
      ? { sourceVideoUrl: o.sourceVideoUrl.trim() }
      : {}),
    ...(typeof o.driveFileId === "string" && o.driveFileId.trim()
      ? { driveFileId: o.driveFileId.trim() }
      : {}),
    ...(typeof o.stitchJobId === "string" && o.stitchJobId.trim()
      ? { stitchJobId: o.stitchJobId.trim() }
      : {}),
    ...(typeof o.aiInstructions === "string"
      ? { aiInstructions: o.aiInstructions }
      : {}),
    outputsWanted: {
      carousel: w.carousel === true,
      photo: w.photo === true,
      short: w.short === true,
      ...(w.xPost === true ? { xPost: true } : {}),
    },
    ...(o.studioSettings && typeof o.studioSettings === "object"
      ? { studioSettings: o.studioSettings as MultiplierProcessingJobPayload["studioSettings"] }
      : {}),
    ...(o.outputs && typeof o.outputs === "object"
      ? { outputs: o.outputs as MultiplierOutputsState }
      : {}),
  };
}
