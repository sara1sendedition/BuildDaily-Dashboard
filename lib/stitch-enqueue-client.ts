"use client";

import { clientApiPath } from "@/lib/client-api-path";

export type StitchEnqueueClip =
  | { source: "drive"; driveFileId: string }
  | { source: "url"; url: string };

export type EnqueueOutputsWanted = {
  carousel: boolean;
  photo: boolean;
  short: boolean;
  xPost?: boolean;
};

export type EnqueueStudioSettings = {
  layoutId?: string;
  carouselOverride?: string;
  frameColorAdjust?: unknown;
};

export type EnqueueStitchToMultiplierInput = {
  videoLabel: string;
  clips: StitchEnqueueClip[];
  correlationId: string;
  aiInstructions?: string;
  queueItemId?: string;
  /** When set (Multiplier), honors Output format toggles. Stitch may omit. */
  outputsWanted?: EnqueueOutputsWanted;
  studioSettings?: EnqueueStudioSettings;
};

export type EnqueueStitchToMultiplierResult =
  | {
      ok: true;
      processingJobId: string;
      queueItemId: string;
      stitchJobId?: string;
      driveFileId?: string;
    }
  | { ok: false; message: string };

/**
 * One keepalive JSON POST: server starts Drive/URL stitch (if needed) and
 * creates the Multiplier ProcessingJob. Survives navigating away from Stitch
 * or Multiplier as long as the request body has already been sent.
 *
 * Also used by Multiplier Drive inbox “Add” (single file → driveFileId job).
 */
export async function enqueueStitchToMultiplier(
  input: EnqueueStitchToMultiplierInput,
): Promise<EnqueueStitchToMultiplierResult> {
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/stitch/enqueue-to-multiplier"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoLabel: input.videoLabel,
        clips: input.clips,
        correlationId: input.correlationId,
        ...(input.aiInstructions?.trim()
          ? { aiInstructions: input.aiInstructions.trim() }
          : {}),
        ...(input.queueItemId ? { queueItemId: input.queueItemId } : {}),
        ...(input.outputsWanted ? { outputsWanted: input.outputsWanted } : {}),
        ...(input.studioSettings
          ? { studioSettings: input.studioSettings }
          : {}),
      }),
      cache: "no-store",
      // Critical: do not cancel when the user leaves Stitch for Multiplier.
      keepalive: true,
    });
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? `Network error: ${e.message}`
          : "Network error while queueing Multiplier.",
    };
  }

  let body: {
    error?: string;
    data?: {
      processingJobId?: string;
      queueItemId?: string;
      stitchJobId?: string;
      driveFileId?: string;
    };
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    return {
      ok: false,
      message:
        (typeof body.error === "string" && body.error.trim()) ||
        `Could not queue Multiplier (HTTP ${res.status}).`,
    };
  }

  const processingJobId = body.data?.processingJobId?.trim();
  const queueItemId = body.data?.queueItemId?.trim();
  if (!processingJobId || !queueItemId) {
    return {
      ok: false,
      message: "Enqueue response missing job id.",
    };
  }

  return {
    ok: true,
    processingJobId,
    queueItemId,
    ...(body.data?.stitchJobId
      ? { stitchJobId: body.data.stitchJobId }
      : {}),
    ...(body.data?.driveFileId
      ? { driveFileId: body.data.driveFileId }
      : {}),
  };
}

/** Multiplier Drive inbox: queue one Drive file for server-side ingest. */
export async function enqueueDriveFileToMultiplier(input: {
  videoLabel: string;
  driveFileId: string;
  queueItemId?: string;
  aiInstructions?: string;
  outputsWanted?: EnqueueOutputsWanted;
  studioSettings?: EnqueueStudioSettings;
}): Promise<EnqueueStitchToMultiplierResult> {
  return enqueueStitchToMultiplier({
    videoLabel: input.videoLabel,
    correlationId:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `drive-${Date.now()}`,
    ...(input.queueItemId ? { queueItemId: input.queueItemId } : {}),
    ...(input.aiInstructions ? { aiInstructions: input.aiInstructions } : {}),
    ...(input.outputsWanted ? { outputsWanted: input.outputsWanted } : {}),
    ...(input.studioSettings ? { studioSettings: input.studioSettings } : {}),
    clips: [{ source: "drive", driveFileId: input.driveFileId }],
  });
}
