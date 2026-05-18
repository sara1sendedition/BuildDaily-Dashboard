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

/** GET /api/v1/brands/[id]/learned-from-edits?limit=50 */
export const GET = withUser(async ({ req, user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    500,
  );

  const rows = await prisma.learnedFromEdit.findMany({
    where: { userId: user.id, brandId: brand.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return json({ data: rows });
});

/** POST /api/v1/brands/[id]/learned-from-edits — append a before/after pair. */
export const POST = withUser(async ({ req, user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const row = await prisma.learnedFromEdit.create({
    data: {
      userId: user.id,
      brandId: brand.id,
      beforeLine: requiredStr(body.beforeLine, "beforeLine"),
      afterLine: requiredStr(body.afterLine, "afterLine"),
      context: str(body.context) ?? null,
    },
  });
  return json({ data: row }, { status: 201 });
});
