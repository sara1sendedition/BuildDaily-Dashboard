import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/**
 * DELETE /api/v1/brands/[id]/documents/[docId]
 *
 * Note: this deletes the DB row only. The underlying file in Bunny Storage
 * is NOT removed here — that requires the storage adapter's delete() call,
 * which is wired up in a follow-up endpoint. Leaving the file in place during
 * the metadata-only delete is intentional: it gives us a window to recover
 * if the user deletes by accident.
 */
export const DELETE = withUser(async ({ user, params }) => {
  const doc = await prisma.brandDocument.findFirst({
    where: {
      id: params.docId,
      brand: { id: params.id, userId: user.id },
    },
  });
  if (!doc) return errors.notFound("BrandDocument", params.docId);

  await prisma.brandDocument.delete({ where: { id: doc.id } });
  return new Response(null, { status: 204 });
});
