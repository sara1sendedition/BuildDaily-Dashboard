import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_MULTIPLIER_MAX_ATTEMPTS,
  MULTIPLIER_JOB_TYPE,
  parseMultiplierJobPayload,
} from "@/lib/multiplier/process-job-types";
import { findActiveMultiplierJob } from "@/lib/multiplier/find-active-job";
import {
  aggregateQueueStatusFromOutputs,
  buildInitialOutputs,
  emptyOutputState,
  type MultiplierOutputsState,
} from "@/lib/multiplier-queue/output-state";

type QueuePayload = {
  v?: number;
  processingJobId?: string;
  driveFileId?: string;
  stitchJobId?: string;
  bunnyUrls?: { sourceVideoUrl?: string };
  outputs?: MultiplierOutputsState;
  aiInstructions?: string;
  outputsWanted?: {
    carousel?: boolean;
    photo?: boolean;
    short?: boolean;
    xPost?: boolean;
  };
  studioSettings?: Record<string, unknown>;
};

/**
 * Create ProcessingJobs for Hub queue rows that have a source (Bunny URL or
 * Drive id) and status processing, but never got a durable job id.
 * Fixes the Hub-proxy 404 era where the browser fell back to tab processing
 * and left rows stuck without server work. Failed rows are left failed.
 */
export async function backfillStuckMultiplierProcessingJobs(opts?: {
  limit?: number;
}): Promise<{ scanned: number; created: number; skipped: number }> {
  const limit = Math.max(1, Math.min(40, Math.floor(opts?.limit ?? 20)));
  const rows = await prisma.multiplierQueueItem.findMany({
    where: {
      // Terminal failures stay failed until the user retries. Auto-creating
      // jobs for `failed` rows is what turned Hub cron into a job storm.
      status: "processing",
    },
    orderBy: { updatedAt: "asc" },
    take: 80,
  });

  let scanned = 0;
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    if (created >= limit) break;
    scanned += 1;
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as QueuePayload)
        : ({} as QueuePayload);

    if (
      typeof payload.processingJobId === "string" &&
      payload.processingJobId.trim()
    ) {
      const jobId = payload.processingJobId.trim();
      const job = await prisma.processingJob.findUnique({
        where: { id: jobId },
        select: { id: true, status: true },
      });
      const shortProcessing = payload.outputs?.short?.status === "processing";
      if (
        job &&
        (job.status === "pending" || job.status === "processing")
      ) {
        skipped += 1;
        continue;
      }
      // Job finished/failed while Short stayed in-flight — re-pend for resume.
      if (
        shortProcessing &&
        job &&
        (job.status === "done" || job.status === "failed")
      ) {
        try {
          await prisma.$transaction([
            prisma.processingJob.update({
              where: { id: jobId },
              data: {
                status: "pending",
                leasedAt: null,
                leaseOwner: null,
                processedAt: null,
                error: "Awaiting Short encode (recovered)…",
              },
            }),
            prisma.multiplierQueueItem.update({
              where: { id: row.id },
              data: { status: "processing" },
            }),
          ]);
          created += 1;
        } catch (e) {
          console.warn(
            `[backfillStuckMultiplierProcessingJobs] re-pend failed for ${row.id}:`,
            e instanceof Error ? e.message : e,
          );
          skipped += 1;
        }
        continue;
      }
      skipped += 1;
      continue;
    }

    if (payload.outputs) {
      const agg = aggregateQueueStatusFromOutputs(payload.outputs);
      if (agg === "done") {
        skipped += 1;
        continue;
      }
    }

    const sourceVideoUrl =
      typeof payload.bunnyUrls?.sourceVideoUrl === "string"
        ? payload.bunnyUrls.sourceVideoUrl.trim()
        : "";
    const driveFileId =
      typeof payload.driveFileId === "string" ? payload.driveFileId.trim() : "";
    const stitchJobId =
      typeof payload.stitchJobId === "string" ? payload.stitchJobId.trim() : "";
    if (!sourceVideoUrl && !driveFileId && !stitchJobId) {
      skipped += 1;
      continue;
    }

    const active = await findActiveMultiplierJob({
      userId: row.userId,
      queueItemId: row.id,
      sourceVideoUrl: sourceVideoUrl || undefined,
      driveFileId: driveFileId || undefined,
      stitchJobId: stitchJobId || undefined,
    });
    if (active) {
      try {
        await prisma.multiplierQueueItem.update({
          where: { id: row.id },
          data: {
            status: "processing",
            payload: {
              ...payload,
              v: 1,
              processingJobId: active.id,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        console.warn(
          `[backfillStuckMultiplierProcessingJobs] attach failed for ${row.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
      skipped += 1;
      continue;
    }

    const wantedRaw = payload.outputsWanted ?? {};
    const outputsWanted = {
      carousel: wantedRaw.carousel !== false,
      photo: wantedRaw.photo !== false,
      short: wantedRaw.short !== false,
      ...(wantedRaw.xPost === true ? { xPost: true as const } : {}),
    };
    // If every flag was explicitly false, skip.
    if (
      !outputsWanted.carousel &&
      !outputsWanted.photo &&
      !outputsWanted.short
    ) {
      skipped += 1;
      continue;
    }

    const outputs = buildInitialOutputs({
      carousel: outputsWanted.carousel,
      photo: outputsWanted.photo,
      short: outputsWanted.short,
    });

    const videoLabel = (row.videoLabel || "video.mp4").trim() || "video.mp4";
    const jobPayload = {
      v: 1 as const,
      queueItemId: row.id,
      videoLabel,
      ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
      ...(driveFileId ? { driveFileId } : {}),
      ...(stitchJobId ? { stitchJobId } : {}),
      ...(typeof payload.aiInstructions === "string"
        ? { aiInstructions: payload.aiInstructions }
        : {}),
      outputsWanted,
      ...(payload.studioSettings && typeof payload.studioSettings === "object"
        ? { studioSettings: payload.studioSettings }
        : {}),
      outputs,
    };

    if (!parseMultiplierJobPayload(jobPayload)) {
      skipped += 1;
      continue;
    }

    const jobId = crypto.randomUUID();
    const nextQueuePayload: Record<string, unknown> = {
      ...payload,
      v: 1,
      processingJobId: jobId,
      outputs,
      ...(sourceVideoUrl
        ? {
            bunnyUrls: {
              ...(payload.bunnyUrls ?? {}),
              sourceVideoUrl,
            },
          }
        : {}),
      ...(driveFileId ? { driveFileId } : {}),
      ...(stitchJobId ? { stitchJobId } : {}),
    };

    try {
      await prisma.$transaction([
        prisma.processingJob.create({
          data: {
            id: jobId,
            userId: row.userId,
            jobType: MULTIPLIER_JOB_TYPE,
            payload: jobPayload as Prisma.InputJsonValue,
            status: "pending",
            maxAttempts: DEFAULT_MULTIPLIER_MAX_ATTEMPTS,
          },
        }),
        prisma.multiplierQueueItem.update({
          where: { id: row.id },
          data: {
            status: "processing",
            payload: nextQueuePayload as Prisma.InputJsonValue,
          },
        }),
      ]);
      created += 1;
    } catch (e) {
      console.warn(
        `[backfillStuckMultiplierProcessingJobs] failed for ${row.id}:`,
        e instanceof Error ? e.message : e,
      );
      skipped += 1;
    }
  }

  return { scanned, created, skipped };
}

/**
 * Re-queue Short-only jobs for rows that failed Short create with the old
 * wrong multipart field name (`video` instead of `file`). Carousel/photo that
 * already finished are left alone.
 */
export async function backfillFailedShortCreates(opts?: {
  limit?: number;
}): Promise<{ scanned: number; created: number; skipped: number }> {
  const limit = Math.max(1, Math.min(20, Math.floor(opts?.limit ?? 10)));
  const rows = await prisma.multiplierQueueItem.findMany({
    where: {
      OR: [
        { status: "done" },
        { status: "processing" },
        { status: "failed" },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 80,
  });

  let scanned = 0;
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    if (created >= limit) break;
    scanned += 1;
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as QueuePayload)
        : ({} as QueuePayload);
    const short = payload.outputs?.short;
    const err = typeof short?.error === "string" ? short.error : "";
    const shortJobId =
      typeof (payload as { shortJobId?: string }).shortJobId === "string"
        ? (payload as { shortJobId?: string }).shortJobId!.trim()
        : "";
    const isMissingFileBug =
      Boolean(err) &&
      (err.includes('body","file"') ||
        err.includes("Field required") ||
        err.includes('loc":["body","file"]') ||
        err.includes("missing job id")) &&
      (short?.status === "failed" ||
        (short?.status === "processing" && !shortJobId));
    if (!isMissingFileBug) {
      skipped += 1;
      continue;
    }

    // Avoid stacking duplicate pending Short-only jobs for the same queue item.
    const existingPending = await prisma.processingJob.findFirst({
      where: {
        jobType: MULTIPLIER_JOB_TYPE,
        status: { in: ["pending", "processing"] },
        payload: {
          path: ["queueItemId"],
          equals: row.id,
        },
      },
      select: { id: true, payload: true },
    });
    if (existingPending) {
      const wanted =
        existingPending.payload &&
        typeof existingPending.payload === "object" &&
        (existingPending.payload as QueuePayload).outputsWanted
          ? (existingPending.payload as QueuePayload).outputsWanted
          : null;
      if (wanted && wanted.short === true && wanted.carousel === false) {
        skipped += 1;
        continue;
      }
    }

    const sourceVideoUrl =
      typeof payload.bunnyUrls?.sourceVideoUrl === "string"
        ? payload.bunnyUrls.sourceVideoUrl.trim()
        : "";
    const driveFileId =
      typeof payload.driveFileId === "string" ? payload.driveFileId.trim() : "";
    const stitchJobId =
      typeof payload.stitchJobId === "string" ? payload.stitchJobId.trim() : "";
    if (!sourceVideoUrl && !driveFileId && !stitchJobId) {
      skipped += 1;
      continue;
    }

    const outputs = buildInitialOutputs({
      carousel: false,
      photo: false,
      short: true,
    });
    // Preserve finished carousel/photo markers so the UI still shows them.
    if (payload.outputs?.carousel?.status === "done") {
      outputs.carousel = payload.outputs.carousel;
    } else {
      outputs.carousel = emptyOutputState("skipped");
    }
    if (payload.outputs?.photo?.status === "done") {
      outputs.photo = payload.outputs.photo;
    } else {
      outputs.photo = emptyOutputState("skipped");
    }

    const videoLabel = (row.videoLabel || "video.mp4").trim() || "video.mp4";
    const jobPayload = {
      v: 1 as const,
      queueItemId: row.id,
      videoLabel,
      ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
      ...(driveFileId ? { driveFileId } : {}),
      ...(stitchJobId ? { stitchJobId } : {}),
      ...(typeof payload.aiInstructions === "string"
        ? { aiInstructions: payload.aiInstructions }
        : {}),
      outputsWanted: {
        carousel: false,
        photo: false,
        short: true,
      },
      outputs,
    };
    if (!parseMultiplierJobPayload(jobPayload)) {
      skipped += 1;
      continue;
    }

    const jobId = crypto.randomUUID();
    const nextQueuePayload: Record<string, unknown> = {
      ...payload,
      v: 1,
      processingJobId: jobId,
      outputs,
      ...(sourceVideoUrl
        ? {
            bunnyUrls: {
              ...(payload.bunnyUrls ?? {}),
              sourceVideoUrl,
            },
          }
        : {}),
      ...(driveFileId ? { driveFileId } : {}),
      ...(stitchJobId ? { stitchJobId } : {}),
    };

    try {
      await prisma.$transaction([
        prisma.processingJob.create({
          data: {
            id: jobId,
            userId: row.userId,
            jobType: MULTIPLIER_JOB_TYPE,
            payload: jobPayload as Prisma.InputJsonValue,
            status: "pending",
            maxAttempts: DEFAULT_MULTIPLIER_MAX_ATTEMPTS,
          },
        }),
        prisma.multiplierQueueItem.update({
          where: { id: row.id },
          data: {
            status: "processing",
            payload: nextQueuePayload as Prisma.InputJsonValue,
          },
        }),
      ]);
      created += 1;
    } catch (e) {
      console.warn(
        `[backfillFailedShortCreates] failed for ${row.id}:`,
        e instanceof Error ? e.message : e,
      );
      skipped += 1;
    }
  }

  return { scanned, created, skipped };
}
