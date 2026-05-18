import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  json,
  readJson,
  str,
} from "@/app/api/v1/_lib/responses";
import { storage } from "@/lib/storage/bunny-adapter";

export const runtime = "nodejs";

/**
 * POST /api/v1/video-jobs
 *
 * Creates a V2S job row + mints a Bunny Stream upload token in one call.
 * Replaces V2S backend's in-memory dict (jobs/store.py) with a real DB row
 * that survives backend restarts.
 *
 * Body (all optional):
 *   { correlationId?: string,   // client-supplied recovery key
 *     title?: string            // Bunny Stream library label }
 */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  const body = parsed.ok ? parsed.data : {};
  const correlationId = str(body.correlationId) ?? null;
  const title = str(body.title) ?? `v2s-${new Date().toISOString()}`;

  const id = crypto.randomUUID();

  // Mint upload token first — if Bunny fails we don't want a dangling row.
  const token = await storage.createUploadToken({
    kind: "video",
    userId: user.id,
    title,
    contentType: "video/mp4",
  });

  const job = await prisma.videoJob.create({
    data: {
      id,
      userId: user.id,
      status: "pending",
      progress: "",
      resultProvider: "bunny-stream",
      resultPath: token.storagePath,
      correlationId,
      meta: {},
    },
  });

  return json(
    { data: { job, upload: token } },
    { status: 201 },
  );
});

/** GET /api/v1/video-jobs — list the user's jobs (recent first). */
export const GET = withUser(async ({ user }) => {
  const jobs = await prisma.videoJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return json({ data: jobs });
});
