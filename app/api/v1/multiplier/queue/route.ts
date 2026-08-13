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
  mergeHubQueuePayload,
  resolveHubQueueStatus,
  withQueueFailureError,
} from "@/lib/multiplier-queue/merge-hub-payload";

export const runtime = "nodejs";

/**
 * GET /api/v1/multiplier/queue — list the current user's processed-video
 * queue (Multiplier home page). Includes scheduled-and-unscheduled items.
 *
 * Query params:
 *   limit  — max rows to return (default 100, capped at 500)
 *   status — filter by status ('processing' | 'done' | 'failed')
 */
export const GET = withUser(async ({ req, user }) => {
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 500)
      : 100;
  const status = url.searchParams.get("status") ?? undefined;
  const rows = await prisma.multiplierQueueItem.findMany({
    where: {
      userId: user.id,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return json({ data: rows });
});

/** POST /api/v1/multiplier/queue — upsert one item (client-supplied id). */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = requiredStr(body.id, "id");
  const videoLabel = requiredStr(body.videoLabel, "videoLabel");
  const statusRaw = str(body.status) ?? "processing";
  if (!["processing", "done", "failed"].includes(statusRaw)) {
    return errors.badRequest(
      "`status` must be 'processing' | 'done' | 'failed'",
    );
  }
  const kindRaw = str(body.kind);
  if (kindRaw && !["carousel", "photo", "short"].includes(kindRaw)) {
    return errors.badRequest(
      "`kind` must be 'carousel' | 'photo' | 'short' when set",
    );
  }

  const existing = await prisma.multiplierQueueItem.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    const payload = withQueueFailureError(
      (body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : { v: 1 }) as Record<string, unknown>,
      statusRaw,
    );
    const row = await prisma.multiplierQueueItem.create({
      data: {
        id,
        userId: user.id,
        videoLabel,
        status: statusRaw,
        kind: kindRaw ?? null,
        payload: payload as object,
      },
    });
    return json({ data: row });
  }

  const mergedPayload = mergeHubQueuePayload(existing.payload, body.payload);
  const status = resolveHubQueueStatus({
    existingStatus: existing.status,
    incomingStatus: statusRaw,
    mergedPayload,
  });
  const payload = withQueueFailureError(mergedPayload, status);

  const row = await prisma.multiplierQueueItem.update({
    where: { id },
    data: {
      videoLabel,
      status,
      kind: kindRaw ?? existing.kind,
      payload: payload as object,
    },
  });
  return json({ data: row });
});
