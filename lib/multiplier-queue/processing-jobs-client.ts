"use client";

import { clientApiPath } from "@/lib/client-api-path";

export type CreateMultiplierProcessingJobInput = {
  queueItemId: string;
  videoLabel: string;
  sourceVideoUrl?: string;
  driveFileId?: string;
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
    return j.error ?? j.detail ?? j.title ?? `Server returned ${res.status}.`;
  } catch {
    return `Server returned ${res.status}: ${text.slice(0, 200)}`;
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
