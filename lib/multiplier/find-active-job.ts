import { prisma } from "@/lib/prisma";
import { MULTIPLIER_JOB_TYPE } from "@/lib/multiplier/process-job-types";

export type ActiveMultiplierJob = {
  id: string;
  payload: unknown;
  status: string;
};

type JobReader = {
  processingJob: {
    findFirst: (typeof prisma)["processingJob"]["findFirst"];
  };
};

/**
 * Find an in-flight Multiplier job for this queue item or the same source
 * video so we do not enqueue duplicates on every cron tick / tab retry.
 */
export async function findActiveMultiplierJob(opts: {
  userId: string;
  queueItemId: string;
  sourceVideoUrl?: string;
  driveFileId?: string;
  db?: JobReader;
}): Promise<ActiveMultiplierJob | null> {
  const db = opts.db ?? prisma;
  const or: Array<{
    payload: { path: string[]; equals: string };
  }> = [{ payload: { path: ["queueItemId"], equals: opts.queueItemId } }];
  const sourceVideoUrl = opts.sourceVideoUrl?.trim() ?? "";
  const driveFileId = opts.driveFileId?.trim() ?? "";
  if (sourceVideoUrl) {
    or.push({ payload: { path: ["sourceVideoUrl"], equals: sourceVideoUrl } });
  }
  if (driveFileId) {
    or.push({ payload: { path: ["driveFileId"], equals: driveFileId } });
  }

  return db.processingJob.findFirst({
    where: {
      userId: opts.userId,
      jobType: MULTIPLIER_JOB_TYPE,
      status: { in: ["pending", "processing"] },
      OR: or,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, payload: true, status: true },
  });
}
