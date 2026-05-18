import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
  str,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/brands/[id]/audience-personas — list personas for a brand. */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const personas = await prisma.audiencePersona.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "asc" },
  });
  return json({ data: personas });
});

/** POST /api/v1/brands/[id]/audience-personas — create a persona. */
export const POST = withUser(async ({ req, user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const persona = await prisma.audiencePersona.create({
    data: {
      brandId: brand.id,
      label: requiredStr(body.label, "label"),
      primaryAudience: str(body.primaryAudience) ?? null,
      audienceDetails: str(body.audienceDetails) ?? null,
      voiceAndTone: str(body.voiceAndTone) ?? null,
      audiencePains: str(body.audiencePains) ?? null,
      believerPersona: str(body.believerPersona) ?? null,
      skepticPersona: str(body.skepticPersona) ?? null,
    },
  });
  return json({ data: persona }, { status: 201 });
});
