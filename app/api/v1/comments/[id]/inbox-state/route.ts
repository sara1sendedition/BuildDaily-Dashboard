import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/comments/[id]/inbox-state
 *
 * Body (any subset):
 *   { surfaced?: boolean, needsResponse?: boolean, conversionReady?: boolean,
 *     archived?: boolean, ignored?: boolean,
 *     snoozedUntil?: ISO string | null, priorityRank?: number }
 *
 * Upserts the row (matches CC's behavior — a comment may have no view state yet).
 */
export const PATCH = withUser(async ({ req, user, params }) => {
  const comment = await prisma.comment.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!comment) return errors.notFound("Comment", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const updateData: Record<string, unknown> = {};
  const createData: Record<string, unknown> = { commentId: comment.id };
  for (const key of [
    "surfaced",
    "needsResponse",
    "conversionReady",
    "archived",
    "ignored",
  ] as const) {
    if (key in body && typeof body[key] === "boolean") {
      updateData[key] = body[key];
      createData[key] = body[key];
    }
  }
  if (
    "snoozedUntil" in body &&
    (body.snoozedUntil === null || typeof body.snoozedUntil === "string")
  ) {
    const v =
      body.snoozedUntil === null ? null : new Date(body.snoozedUntil as string);
    if (v && Number.isNaN(v.getTime())) {
      return errors.badRequest("`snoozedUntil` must be ISO timestamp or null");
    }
    updateData.snoozedUntil = v;
    createData.snoozedUntil = v;
  }
  if ("priorityRank" in body && typeof body.priorityRank === "number") {
    updateData.priorityRank = body.priorityRank;
    createData.priorityRank = body.priorityRank;
  }

  const state = await prisma.inboxViewState.upsert({
    where: { commentId: comment.id },
    update: updateData,
    create: createData as { commentId: string },
  });
  return json({ data: state });
});
