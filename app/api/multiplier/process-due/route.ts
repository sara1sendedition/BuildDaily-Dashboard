import { withUser } from "@/app/api/v1/_lib/with-user";
import { json } from "@/app/api/v1/_lib/responses";
import { backfillStuckMultiplierProcessingJobs } from "@/lib/multiplier/backfill-stuck-jobs";
import { claimMultiplierProcessingJobs } from "@/lib/multiplier/claim-processing-jobs";
import { runClaimedMultiplierJobsInBackground } from "@/lib/multiplier/run-claimed-jobs-background";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/multiplier/process-due
 *
 * Signed-in kick: claim up to N of the user's jobs and continue them in the
 * background so the browser request can return quickly.
 */
export const POST = withUser(async ({ user }) => {
  const raw = Number(
    process.env.MULTIPLIER_PROCESS_CONCURRENCY?.trim() || "3",
  );
  const limit = Number.isFinite(raw)
    ? Math.max(1, Math.min(5, Math.floor(raw)))
    : 3;

  let backfill = { scanned: 0, created: 0, skipped: 0 };
  try {
    backfill = await backfillStuckMultiplierProcessingJobs({ limit: 8 });
  } catch {
    /* ignore */
  }

  const leaseOwner = `user-kick:${user.id}:${Date.now()}`;
  const claimed = await claimMultiplierProcessingJobs({
    limit,
    leaseOwner,
    userId: user.id,
  });

  runClaimedMultiplierJobsInBackground(claimed, {
    finalizeLimit: 3,
    logLabel: "user-process-due",
  });

  return json({
    data: {
      claimed: claimed.length,
      concurrency: limit,
      started: true,
      backfill,
    },
  });
});
