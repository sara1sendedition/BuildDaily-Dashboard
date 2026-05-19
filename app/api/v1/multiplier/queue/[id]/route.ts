import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";

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
    const incoming = body.payload as Record<string, unknown>;
    const current =
      existing.payload && typeof existing.payload === "object"
        ? (existing.payload as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(incoming)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    data.payload = merged;
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
    select: { id: true },
  });
  if (!existing) return errors.notFound("MultiplierQueueItem", params.id);
  await prisma.multiplierQueueItem.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
