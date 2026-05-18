import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/brands/[id]/copy-feedback — "notes for the next AI run". */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { copyFeedback: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);
  return json({ data: { copyFeedback: brand.copyFeedback ?? "" } });
});

/** PUT /api/v1/brands/[id]/copy-feedback — overwrite the feedback blob. */
export const PUT = withUser(async ({ req, user, params }) => {
  const existing = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;

  const next = str(parsed.data.copyFeedback) ?? "";
  const brand = await prisma.brand.update({
    where: { id: params.id },
    data: { copyFeedback: next },
    select: { copyFeedback: true },
  });
  return json({ data: { copyFeedback: brand.copyFeedback ?? "" } });
});
