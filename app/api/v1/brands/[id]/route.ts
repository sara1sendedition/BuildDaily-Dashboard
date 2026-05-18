import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  str,
  optStrArr,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/brands/[id] — full brand including personas, products, documents. */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      audiencePersonas: { orderBy: { createdAt: "asc" } },
      products: { orderBy: { displayOrder: "asc" } },
      brandDocuments: { orderBy: { uploadedAt: "desc" } },
    },
  });
  if (!brand) return errors.notFound("Brand", params.id);
  return json({ data: brand });
});

/** PATCH /api/v1/brands/[id] — partial update. */
export const PATCH = withUser(async ({ req, user, params }) => {
  const existing = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = str(body.name) ?? "";
  if ("industry" in body) data.industry = str(body.industry) ?? null;
  if ("businessType" in body) data.businessType = str(body.businessType) ?? null;
  if ("businessDescription" in body) data.businessDescription = str(body.businessDescription) ?? null;
  if ("valueProps" in body) data.valueProps = str(body.valueProps) ?? null;
  if ("boundaries" in body) data.boundaries = str(body.boundaries) ?? null;
  if ("audienceTags" in body) data.audienceTags = optStrArr(body.audienceTags) ?? [];
  if ("briefCombinedText" in body) data.briefCombinedText = str(body.briefCombinedText) ?? null;
  if ("copyContext" in body) data.copyContext = str(body.copyContext) ?? null;
  if ("copyFeedback" in body) data.copyFeedback = str(body.copyFeedback) ?? null;
  if ("defaultCaptionCta" in body) data.defaultCaptionCta = str(body.defaultCaptionCta) ?? null;
  if ("goals" in body) data.goals = optStrArr(body.goals) ?? [];
  if ("funnelNotes" in body) data.funnelNotes = str(body.funnelNotes) ?? null;

  const brand = await prisma.brand.update({
    where: { id: params.id },
    data,
  });
  return json({ data: brand });
});

/** DELETE /api/v1/brands/[id] — cascades to personas, products, documents, etc. */
export const DELETE = withUser(async ({ user, params }) => {
  const existing = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return errors.notFound("Brand", params.id);
  await prisma.brand.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
