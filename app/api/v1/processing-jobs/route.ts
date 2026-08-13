import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
  str,
} from "@/app/api/v1/_lib/responses";
import {
  DEFAULT_MULTIPLIER_MAX_ATTEMPTS,
  MULTIPLIER_JOB_TYPE,
  parseMultiplierJobPayload,
} from "@/lib/multiplier/process-job-types";
import { findActiveMultiplierJob } from "@/lib/multiplier/find-active-job";
import { mergeQueuePayloadForJob } from "@/lib/multiplier-queue/merge-hub-payload";
import { buildInitialOutputs } from "@/lib/multiplier-queue/output-state";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/**
 * POST /api/v1/processing-jobs
 *
 * Create a durable Multiplier processing job after the source video is on
 * Bunny (or a Drive file id is known). Also upserts the MultiplierQueueItem.
 * Reuses an existing pending/processing job for the same queue item or source.
 */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const queueItemId = requiredStr(body.queueItemId, "queueItemId");
  const videoLabel = requiredStr(body.videoLabel, "videoLabel");
  const sourceVideoUrl = str(body.sourceVideoUrl);
  const driveFileId = str(body.driveFileId);
  if (!sourceVideoUrl && !driveFileId) {
    return errors.badRequest(
      "Provide `sourceVideoUrl` and/or `driveFileId` so the worker can ingest the video after tab close.",
    );
  }

  const outputsWantedRaw =
    body.outputsWanted && typeof body.outputsWanted === "object"
      ? (body.outputsWanted as Record<string, unknown>)
      : {};
  const outputsWanted = {
    carousel: outputsWantedRaw.carousel === true,
    photo: outputsWantedRaw.photo === true,
    short: outputsWantedRaw.short === true,
    ...(outputsWantedRaw.xPost === true ? { xPost: true as const } : {}),
  };
  if (
    !outputsWanted.carousel &&
    !outputsWanted.photo &&
    !outputsWanted.short
  ) {
    return errors.badRequest("Choose at least one output in `outputsWanted`.");
  }

  const outputs = buildInitialOutputs({
    carousel: outputsWanted.carousel,
    photo: outputsWanted.photo,
    short: outputsWanted.short,
  });

  const jobPayload = {
    v: 1 as const,
    queueItemId,
    videoLabel,
    ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
    ...(driveFileId ? { driveFileId } : {}),
    ...(typeof body.aiInstructions === "string"
      ? { aiInstructions: body.aiInstructions }
      : {}),
    outputsWanted,
    ...(body.studioSettings && typeof body.studioSettings === "object"
      ? { studioSettings: body.studioSettings }
      : {}),
    outputs,
  };

  if (!parseMultiplierJobPayload(jobPayload)) {
    return errors.badRequest("Could not build a valid multiplier job payload.");
  }

  const existingQueue = await prisma.multiplierQueueItem.findUnique({
    where: { id: queueItemId },
    select: { userId: true },
  });
  if (existingQueue && existingQueue.userId !== user.id) {
    return errors.badRequest(
      "A queue item with this id already exists for another user.",
    );
  }

  const queueIncoming: Record<string, unknown> = {
    v: 1,
    outputs,
    ...(sourceVideoUrl ? { bunnyUrls: { sourceVideoUrl } } : {}),
    ...(driveFileId ? { driveFileId } : {}),
    ...(typeof body.aiInstructions === "string"
      ? { aiInstructions: body.aiInstructions }
      : {}),
  };
  const lockKey = sourceVideoUrl || driveFileId || queueItemId;
  const lockNamespace = `multiplier-job:${user.id}`;
  const maxAttempts =
    typeof body.maxAttempts === "number" && body.maxAttempts > 0
      ? Math.min(8, Math.floor(body.maxAttempts))
      : DEFAULT_MULTIPLIER_MAX_ATTEMPTS;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(CAST(${lockNamespace} AS text)),
        hashtext(CAST(${lockKey} AS text))
      )
    `;

    const lockedQueue = await tx.multiplierQueueItem.findUnique({
      where: { id: queueItemId },
      select: { payload: true },
    });
    const priorPayload =
      lockedQueue?.payload && typeof lockedQueue.payload === "object"
        ? (lockedQueue.payload as Record<string, unknown>)
        : {};

    const active = await findActiveMultiplierJob({
      userId: user.id,
      queueItemId,
      sourceVideoUrl: sourceVideoUrl || undefined,
      driveFileId: driveFileId || undefined,
      db: tx,
    });

    if (active) {
      const existingParsed = parseMultiplierJobPayload(active.payload);
      if (
        existingParsed &&
        existingParsed.queueItemId &&
        existingParsed.queueItemId !== queueItemId
      ) {
        const nextPayload = {
          ...(typeof active.payload === "object" && active.payload
            ? (active.payload as Record<string, unknown>)
            : {}),
          queueItemId,
          videoLabel,
        };
        await tx.processingJob.update({
          where: { id: active.id },
          data: { payload: nextPayload as Prisma.InputJsonValue },
        });
      }

      const mergedQueuePayload = mergeQueuePayloadForJob(
        priorPayload,
        queueIncoming,
        active.id,
        { preserveOutputs: true },
      );
      await tx.multiplierQueueItem.upsert({
        where: { id: queueItemId },
        create: {
          id: queueItemId,
          userId: user.id,
          status: "processing",
          videoLabel,
          payload: mergedQueuePayload as Prisma.InputJsonValue,
        },
        update: {
          status: "processing",
          videoLabel,
          payload: mergedQueuePayload as Prisma.InputJsonValue,
        },
      });
      return { jobId: active.id, reused: true as const };
    }

    const jobId = crypto.randomUUID();
    await tx.processingJob.create({
      data: {
        id: jobId,
        userId: user.id,
        jobType: MULTIPLIER_JOB_TYPE,
        payload: jobPayload as Prisma.InputJsonValue,
        status: "pending",
        maxAttempts,
      },
    });
    const mergedQueuePayload = mergeQueuePayloadForJob(
      priorPayload,
      queueIncoming,
      jobId,
    );
    await tx.multiplierQueueItem.upsert({
      where: { id: queueItemId },
      create: {
        id: queueItemId,
        userId: user.id,
        status: "processing",
        videoLabel,
        payload: mergedQueuePayload as Prisma.InputJsonValue,
      },
      update: {
        status: "processing",
        videoLabel,
        payload: mergedQueuePayload as Prisma.InputJsonValue,
        kind: null,
      },
    });
    return { jobId, reused: false as const };
  });

  if (result.reused) {
    return json({
      data: { job: { id: result.jobId }, queueItemId, reused: true },
    });
  }
  return json(
    { data: { job: { id: result.jobId }, queueItemId } },
    { status: 201 },
  );
});

/** GET /api/v1/processing-jobs — recent jobs for the signed-in user. */
export const GET = withUser(async ({ user, req }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
    : 40;

  const jobs = await prisma.processingJob.findMany({
    where: {
      userId: user.id,
      jobType: MULTIPLIER_JOB_TYPE,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return json({ data: jobs });
});
