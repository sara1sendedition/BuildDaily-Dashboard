import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/brands/[id]/default-caption-cta */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { defaultCaptionCta: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);
  return json({
    data: { defaultCaptionCta: brand.defaultCaptionCta ?? "" },
  });
});

/** PUT /api/v1/brands/[id]/default-caption-cta */
export const PUT = withUser(async ({ req, user, params }) => {
  const existing = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;

  const next = str(parsed.data.defaultCaptionCta) ?? "";
  const brand = await prisma.brand.update({
    where: { id: params.id },
    data: { defaultCaptionCta: next },
    select: { defaultCaptionCta: true },
  });
  return json({
    data: { defaultCaptionCta: brand.defaultCaptionCta ?? "" },
  });
});
