import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
  str,
} from "@/app/api/v1/_lib/responses";
import { storage } from "@/lib/storage/bunny-adapter";
import type { StorageKind } from "@/lib/storage/contracts";

export const runtime = "nodejs";

const KINDS: readonly StorageKind[] = [
  "video",
  "broll",
  "brand-doc",
  "avatar",
  "thumbnail",
];

/**
 * POST /api/v1/storage/upload-token
 *
 * Body:
 *   { kind: "video" | "broll" | "brand-doc" | "avatar" | "thumbnail",
 *     contentType?: string,
 *     filename?: string,
 *     title?: string,           // human-readable label for Stream videos
 *     expiresInSec?: number }
 *
 * Returns the signed payload the browser uses to upload direct to Bunny.
 * The bytes never flow through the hub.
 */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const kind = requiredStr(body.kind, "kind") as StorageKind;
  if (!KINDS.includes(kind)) {
    return errors.badRequest(`\`kind\` must be one of: ${KINDS.join(", ")}`);
  }

  try {
    const token = await storage.createUploadToken({
      kind,
      userId: user.id,
      contentType: str(body.contentType),
      filename: str(body.filename),
      title: str(body.title),
      expiresInSec:
        typeof body.expiresInSec === "number" ? body.expiresInSec : undefined,
    });
    return json({ data: token });
  } catch (err) {
    console.error("[upload-token] mint failed:", err);
    return errors.internal(
      err instanceof Error ? err.message : "Could not mint upload token",
    );
  }
});
