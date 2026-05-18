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

/** GET /api/v1/brands/[id]/products */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const products = await prisma.product.findMany({
    where: { brandId: brand.id },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return json({ data: products });
});

/** POST /api/v1/brands/[id]/products */
export const POST = withUser(async ({ req, user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const product = await prisma.product.create({
    data: {
      brandId: brand.id,
      name: requiredStr(body.name, "name"),
      description: str(body.description) ?? null,
      url: str(body.url) ?? null,
      cta: str(body.cta) ?? null,
      priceCents:
        typeof body.priceCents === "number"
          ? Math.round(body.priceCents)
          : null,
      displayOrder:
        typeof body.displayOrder === "number" ? body.displayOrder : 0,
    },
  });
  return json({ data: product }, { status: 201 });
});
