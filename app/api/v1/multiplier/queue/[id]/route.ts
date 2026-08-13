import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";
import {
  mergeHubQueuePayload,
  resolveHubQueueStatus,
  withQueueFailureError,
} from "@/lib/multiplier-queue/merge-hub-payload";
import { MULTIPLIER_JOB_TYPE } from "@/lib/multiplier/process-job-types";

export const runtime = "nodejs";

/** GET /api/v1/multiplier/queue/[id] */
export const GET = withUser(async ({ user, params }) => {
  const row = await prisma.multiplierQueueItem.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!row) return errors.notFound("MultiplierQueueItem", params.id);
  return json({ data: row });
});

/**
 * PATCH /api/v1/multiplier/queue/[id] — narrow update for callers that only
 * want to bump status, kind, or merge payload fields.
 *
 * Body (any subset):
 *   { status?, kind?, videoLabel?, payload?: { ... } }
 *
 * `payload` is shallow-merged onto the existing payload — pass a new field
 * to add it; pass `null` for a field to delete it.
 */
export const PATCH = withUser(async ({ req, user, params }) => {
  const existing = await prisma.multiplierQueueItem.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!existing) return errors.notFound("MultiplierQueueItem", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if ("status" in body) {
    const v = str(body.status);
    if (!v || !["processing", "done", "failed"].includes(v)) {
      return errors.badRequest(
        "`status` must be 'processing' | 'done' | 'failed'",
      );
    }
    data.status = v;
  }
  if ("kind" in body) {
    const v = str(body.kind);
    if (v && !["carousel", "photo", "short"].includes(v)) {
      return errors.badRequest(
        "`kind` must be 'carousel' | 'photo' | 'short' when set",
      );
    }
    data.kind = v ?? null;
  }
  if ("videoLabel" in body) {
    const v = str(body.videoLabel);
    if (v) data.videoLabel = v;
  }
  if (
    "payload" in body &&
    body.payload &&
    typeof body.payload === "object"
  ) {
    data.payload = mergeHubQueuePayload(existing.payload, body.payload);
  }

  if ("status" in data && typeof data.status === "string") {
    const mergedPayload =
      (data.payload as Record<string, unknown> | undefined) ??
      (existing.payload && typeof existing.payload === "object"
        ? (existing.payload as Record<string, unknown>)
        : {});
    const resolved = resolveHubQueueStatus({
      existingStatus: existing.status,
      incomingStatus: data.status,
      mergedPayload,
    });
    data.status = resolved;
    data.payload = withQueueFailureError(mergedPayload, resolved);
  }

  const row = await prisma.multiplierQueueItem.update({
    where: { id: params.id },
    data,
  });
  return json({ data: row });
});

/** DELETE /api/v1/multiplier/queue/[id] */
export const DELETE = withUser(async ({ user, params }) => {
  const existing = await prisma.multiplierQueueItem.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true, status: true, payload: true },
  });
  if (!existing) return errors.notFound("MultiplierQueueItem", params.id);

  // Guard against a client stitch-handoff bug that deleted durable Hub stubs
  // (empty File + status processing) while server jobs were still running.
  const payload =
    existing.payload && typeof existing.payload === "object"
      ? (existing.payload as Record<string, unknown>)
      : {};
  const processingJobId =
    typeof payload.processingJobId === "string"
      ? payload.processingJobId.trim()
      : "";
  const sourceVideoUrl =
    payload.bunnyUrls &&
    typeof payload.bunnyUrls === "object" &&
    typeof (payload.bunnyUrls as Record<string, unknown>).sourceVideoUrl ===
      "string"
      ? String(
          (payload.bunnyUrls as Record<string, unknown>).sourceVideoUrl,
        ).trim()
      : "";
  if (processingJobId) {
    const job = await prisma.processingJob.findFirst({
      where: {
        id: processingJobId,
        userId: user.id,
        jobType: MULTIPLIER_JOB_TYPE,
        status: { in: ["pending", "processing"] },
      },
      select: { id: true },
    });
    if (job) {
      return errors.badRequest(
        "Cannot delete a Multiplier queue item while its durable job is still pending or processing.",
      );
    }
  }
  if (
    existing.status === "processing" &&
    (processingJobId || sourceVideoUrl)
  ) {
    return errors.badRequest(
      "Cannot delete a durable in-flight Multiplier queue item. Wait for processing to finish, or cancel the job first.",
    );
  }

  await prisma.multiplierQueueItem.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
