import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";
import { storage } from "@/lib/storage/bunny-adapter";

export const runtime = "nodejs";

/**
 * GET /api/v1/video-jobs/by-correlation-id/[correlationId]
 *
 * The recovery endpoint used by Multiplier's client when the upload-response
 * round-trip was lost (mobile suspend, tab backgrounded). Client persists the
 * correlation_id BEFORE the upload starts; if the response is lost, it looks
 * up the original job via this endpoint.
 *
 * Mirrors the FastAPI V2S backend's
 * `/api/video-to-short/jobs/by-correlation-id/{correlation_id}` behavior.
 */
export const GET = withUser(async ({ user, params }) => {
  const job = await prisma.videoJob.findFirst({
    where: {
      correlationId: params.correlationId,
      userId: user.id,
    },
  });
  if (!job) return errors.notFound("VideoJob", params.correlationId);

  const playbackUrl =
    job.status === "completed" && job.resultPath
      ? storage.getPlaybackUrl({
          kind: "video",
          storagePath: job.resultPath,
        })
      : null;

  return json({ data: { ...job, playbackUrl } });
});
