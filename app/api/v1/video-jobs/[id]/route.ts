import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json, readJson, str } from "@/app/api/v1/_lib/responses";
import { storage } from "@/lib/storage/bunny-adapter";

export const runtime = "nodejs";

/** GET /api/v1/video-jobs/[id] — status poll. */
export const GET = withUser(async ({ user, params }) => {
  const job = await prisma.videoJob.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!job) return errors.notFound("VideoJob", params.id);

  // Attach playback URL when the job is complete.
  const playbackUrl =
    job.status === "completed" && job.resultPath
      ? storage.getPlaybackUrl({
          kind: "video",
          storagePath: job.resultPath,
        })
      : null;

  return json({ data: { ...job, playbackUrl } });
});

/**
 * PATCH /api/v1/video-jobs/[id]
 *
 * Worker-side update from the V2S backend (status, progress, error, meta).
 * Once the worker switches to a Clerk service token, this works as-is —
 * the worker authenticates as a service identity that owns no jobs, so
 * we deliberately skip the `userId: user.id` filter and check the row
 * exists at all. Tighten later if we add per-job service identities.
 */
export const PATCH = withUser(async ({ req, user, params }) => {
  const job = await prisma.videoJob.findFirst({
    where: { id: params.id, OR: [{ userId: user.id }, { userId: null }] },
    select: { id: true },
  });
  if (!job) return errors.notFound("VideoJob", params.id);

  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if ("status" in body) {
    const v = str(body.status);
    if (
      v === "pending" ||
      v === "processing" ||
      v === "completed" ||
      v === "failed"
    ) {
      data.status = v;
    }
  }
  if ("progress" in body) data.progress = str(body.progress) ?? "";
  if ("error" in body) data.error = str(body.error) ?? null;
  if ("workDir" in body) data.workDir = str(body.workDir) ?? null;
  if ("resultPath" in body) data.resultPath = str(body.resultPath) ?? null;
  if ("meta" in body && typeof body.meta === "object" && body.meta !== null) {
    data.meta = body.meta;
  }

  const updated = await prisma.videoJob.update({
    where: { id: params.id },
    data,
  });
  return json({ data: updated });
});
