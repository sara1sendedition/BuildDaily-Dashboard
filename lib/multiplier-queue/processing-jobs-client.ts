"use client";

import { clientApiPath } from "@/lib/client-api-path";
import { sanitizeQueueErrorMessage } from "@/lib/multiplier-queue/merge-hub-payload";

export type CreateMultiplierProcessingJobInput = {
  queueItemId: string;
  videoLabel: string;
  sourceVideoUrl?: string;
  driveFileId?: string;
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
};

export type CreateMultiplierProcessingJobResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; message: string };

async function parseProblem(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `Server returned ${res.status}.`;
  try {
    const j = JSON.parse(text) as {
      error?: string;
      detail?: string;
      title?: string;
    };
    return sanitizeQueueErrorMessage(
      j.error ?? j.detail ?? j.title ?? `Server returned ${res.status}.`,
    );
  } catch {
    return sanitizeQueueErrorMessage(
      `Server returned ${res.status}: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Create a durable Multiplier ProcessingJob on this app (same Postgres the
 * cron worker claims from). Prefer local `/api/v1/processing-jobs` — do not
 * rely on a Hub proxy round-trip for job create.
 */
export async function createMultiplierProcessingJob(
  input: CreateMultiplierProcessingJobInput,
): Promise<CreateMultiplierProcessingJobResult> {
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/v1/processing-jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message:
        e instanceof Error ? `Network error: ${e.message}` : "Network error.",
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: await parseProblem(res) };
  }
  try {
    const body = (await res.json()) as {
      data?: { job?: { id?: string } };
    };
    const jobId = body.data?.job?.id;
    if (!jobId) {
      return {
        ok: false,
        status: res.status,
        message: "Create job response missing job id.",
      };
    }
    return { ok: true, jobId };
  } catch {
    return {
      ok: false,
      status: res.status,
      message: "Server returned invalid JSON.",
    };
  }
}

/**
 * Create a Hub queue row + ProcessingJob from a server-side source
 * (Drive id, stitch job, or Bunny URL). Used by Stitch so the laptop
 * can close after enqueue — the Hub cron worker does the rest.
 */
export async function enqueueServerMultiplierJob(input: {
  videoLabel: string;
  queueItemId?: string;
  sourceVideoUrl?: string;
  driveFileId?: string;
  stitchJobId?: string;
  aiInstructions?: string;
  outputsWanted?: CreateMultiplierProcessingJobInput["outputsWanted"];
  studioSettings?: CreateMultiplierProcessingJobInput["studioSettings"];
}): Promise<CreateMultiplierProcessingJobResult> {
  const created = await createMultiplierProcessingJob({
    queueItemId: input.queueItemId?.trim() || crypto.randomUUID(),
    videoLabel: input.videoLabel.trim() || "video.mp4",
    ...(input.sourceVideoUrl ? { sourceVideoUrl: input.sourceVideoUrl } : {}),
    ...(input.driveFileId ? { driveFileId: input.driveFileId } : {}),
    ...(input.stitchJobId ? { stitchJobId: input.stitchJobId } : {}),
    ...(input.aiInstructions ? { aiInstructions: input.aiInstructions } : {}),
    outputsWanted: input.outputsWanted ?? {
      carousel: true,
      photo: true,
      short: true,
    },
    ...(input.studioSettings ? { studioSettings: input.studioSettings } : {}),
  });
  if (created.ok) {
    void kickMultiplierProcessingDue();
  }
  return created;
}

/** Kick server processing for the signed-in user's pending jobs. */
export async function kickMultiplierProcessingDue(): Promise<void> {
  try {
    await fetch(clientApiPath("/api/multiplier/process-due"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch (e) {
    console.warn("[multiplier] process-due kick failed:", e);
  }
}
