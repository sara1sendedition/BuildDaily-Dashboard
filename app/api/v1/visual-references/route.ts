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

/** GET /api/v1/visual-references?kind=carousel|photo|image */
export const GET = withUser(async ({ req, user }) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? undefined;
  if (kind && !["carousel", "photo", "image"].includes(kind)) {
    return errors.badRequest("`kind` must be carousel | photo | image");
  }
  const rows = await prisma.visualReference.findMany({
    where: { userId: user.id, kind },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: rows });
});

/** POST /api/v1/visual-references */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const kind = requiredStr(body.kind, "kind");
  if (!["carousel", "photo", "image"].includes(kind)) {
    return errors.badRequest("`kind` must be carousel | photo | image");
  }
  if (typeof body.profile !== "object" || body.profile === null) {
    return errors.badRequest("`profile` must be a JSON object");
  }

  const row = await prisma.visualReference.create({
    data: {
      userId: user.id,
      brandId: str(body.brandId) ?? null,
      kind,
      profile: body.profile as object,
      thumbnailStoragePath: str(body.thumbnailStoragePath) ?? null,
    },
  });
  return json({ data: row }, { status: 201 });
});
