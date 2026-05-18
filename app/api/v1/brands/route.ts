import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
  str,
  optStrArr,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/brands — list the signed-in user's brands. */
export const GET = withUser(async ({ user }) => {
  const brands = await prisma.brand.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: brands });
});

/** POST /api/v1/brands — create a brand. */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const name = requiredStr(body.name, "name");
  const id = str(body.id) ?? crypto.randomUUID();

  const brand = await prisma.brand.create({
    data: {
      id,
      userId: user.id,
      name,
      industry: str(body.industry) ?? null,
      businessType: str(body.businessType) ?? null,
      businessDescription: str(body.businessDescription) ?? null,
      valueProps: str(body.valueProps) ?? null,
      boundaries: str(body.boundaries) ?? null,
      audienceTags: optStrArr(body.audienceTags) ?? [],
      briefCombinedText: str(body.briefCombinedText) ?? null,
      copyContext: str(body.copyContext) ?? null,
      copyFeedback: str(body.copyFeedback) ?? null,
      defaultCaptionCta: str(body.defaultCaptionCta) ?? null,
      goals: optStrArr(body.goals) ?? [],
      funnelNotes: str(body.funnelNotes) ?? null,
    },
  });
  return json({ data: brand }, { status: 201 });
});
