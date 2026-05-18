import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  json,
  readJson,
  requiredStr,
  str,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/reference-sources?brandId=X (optional filter). */
export const GET = withUser(async ({ req, user }) => {
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId") ?? undefined;
  const rows = await prisma.referenceSource.findMany({
    where: { userId: user.id, brandId },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: rows });
});

/** POST /api/v1/reference-sources */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const row = await prisma.referenceSource.create({
    data: {
      userId: user.id,
      brandId: str(body.brandId) ?? null,
      content: requiredStr(body.content, "content"),
      sourceLabel: str(body.sourceLabel) ?? null,
    },
  });
  return json({ data: row }, { status: 201 });
});
