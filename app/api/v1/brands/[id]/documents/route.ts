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

/** GET /api/v1/brands/[id]/documents */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const documents = await prisma.brandDocument.findMany({
    where: { brandId: brand.id },
    orderBy: { uploadedAt: "desc" },
  });
  return json({ data: documents });
});

/**
 * POST /api/v1/brands/[id]/documents — register a document AFTER its file
 * has been uploaded to Bunny Storage via /api/v1/storage/upload-token.
 * The client uploads direct to Bunny, then POSTs the resulting `storagePath`
 * here to persist the metadata + extracted text.
 */
export const POST = withUser(async ({ req, user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = str(body.id) ?? crypto.randomUUID();
  const doc = await prisma.brandDocument.create({
    data: {
      id,
      brandId: brand.id,
      fileName: requiredStr(body.fileName, "fileName"),
      storageProvider: str(body.storageProvider) ?? "bunny-storage",
      storagePath: requiredStr(body.storagePath, "storagePath"),
      mimeType: str(body.mimeType) ?? null,
      extractedText: str(body.extractedText) ?? null,
    },
  });
  return json({ data: doc }, { status: 201 });
});
