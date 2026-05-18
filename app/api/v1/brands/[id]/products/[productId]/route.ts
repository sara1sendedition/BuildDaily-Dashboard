import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

async function ensureOwnership(
  brandId: string,
  productId: string,
  userId: string,
) {
  return prisma.product.findFirst({
    where: { id: productId, brand: { id: brandId, userId } },
  });
}

/** PATCH /api/v1/brands/[id]/products/[productId] */
export const PATCH = withUser(async ({ req, user, params }) => {
  const product = await ensureOwnership(
    params.id,
    params.productId,
    user.id,
  );
  if (!product) return errors.notFound("Product", params.productId);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = str(body.name) ?? product.name;
  if ("description" in body) data.description = str(body.description) ?? null;
  if ("url" in body) data.url = str(body.url) ?? null;
  if ("cta" in body) data.cta = str(body.cta) ?? null;
  if ("priceCents" in body) {
    data.priceCents =
      typeof body.priceCents === "number"
        ? Math.round(body.priceCents)
        : null;
  }
  if ("displayOrder" in body) {
    data.displayOrder =
      typeof body.displayOrder === "number" ? body.displayOrder : 0;
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data,
  });
  return json({ data: updated });
});

/** DELETE /api/v1/brands/[id]/products/[productId] */
export const DELETE = withUser(async ({ user, params }) => {
  const product = await ensureOwnership(
    params.id,
    params.productId,
    user.id,
  );
  if (!product) return errors.notFound("Product", params.productId);
  await prisma.product.delete({ where: { id: product.id } });
  return new Response(null, { status: 204 });
});
