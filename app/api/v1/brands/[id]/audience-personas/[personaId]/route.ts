import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

async function ensureOwnership(
  brandId: string,
  personaId: string,
  userId: string,
) {
  const persona = await prisma.audiencePersona.findFirst({
    where: {
      id: personaId,
      brand: { id: brandId, userId },
    },
  });
  return persona;
}

/** PATCH /api/v1/brands/[id]/audience-personas/[personaId] */
export const PATCH = withUser(async ({ req, user, params }) => {
  const persona = await ensureOwnership(params.id, params.personaId, user.id);
  if (!persona) return errors.notFound("AudiencePersona", params.personaId);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if ("label" in body) data.label = str(body.label) ?? persona.label;
  if ("primaryAudience" in body) data.primaryAudience = str(body.primaryAudience) ?? null;
  if ("audienceDetails" in body) data.audienceDetails = str(body.audienceDetails) ?? null;
  if ("voiceAndTone" in body) data.voiceAndTone = str(body.voiceAndTone) ?? null;
  if ("audiencePains" in body) data.audiencePains = str(body.audiencePains) ?? null;
  if ("believerPersona" in body) data.believerPersona = str(body.believerPersona) ?? null;
  if ("skepticPersona" in body) data.skepticPersona = str(body.skepticPersona) ?? null;

  const updated = await prisma.audiencePersona.update({
    where: { id: persona.id },
    data,
  });
  return json({ data: updated });
});

/** DELETE /api/v1/brands/[id]/audience-personas/[personaId] */
export const DELETE = withUser(async ({ user, params }) => {
  const persona = await ensureOwnership(params.id, params.personaId, user.id);
  if (!persona) return errors.notFound("AudiencePersona", params.personaId);
  await prisma.audiencePersona.delete({ where: { id: persona.id } });
  return new Response(null, { status: 204 });
});
