import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/comments/[id]/drafts */
export const GET = withUser(async ({ user, params }) => {
  const comment = await prisma.comment.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!comment) return errors.notFound("Comment", params.id);

  const drafts = await prisma.draftReply.findMany({
    where: { commentId: comment.id },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: drafts });
});

/** POST /api/v1/comments/[id]/drafts — create a new draft reply. */
export const POST = withUser(async ({ req, user, params }) => {
  const comment = await prisma.comment.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!comment) return errors.notFound("Comment", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const draft = await prisma.draftReply.create({
    data: {
      id: crypto.randomUUID(),
      commentId: comment.id,
      variant: requiredStr(body.variant, "variant"),
      body: requiredStr(body.body, "body"),
      classificationVersion:
        typeof body.classificationVersion === "number"
          ? body.classificationVersion
          : null,
    },
  });
  return json({ data: draft }, { status: 201 });
});
