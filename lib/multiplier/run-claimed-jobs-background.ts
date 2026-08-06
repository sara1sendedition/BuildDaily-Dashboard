import {
  claimMultiplierProcessingJobs,
  markProcessingJobAwaitingShort,
  markProcessingJobDone,
  markProcessingJobFailedOrRetry,
  type ClaimedProcessingJob,
} from "@/lib/multiplier/claim-processing-jobs";
import {
  finalizeInFlightShortOutputs,
  runMultiplierProcessingJob,
} from "@/lib/multiplier/run-multiplier-job";
import {
  isOpenAIQuotaError,
  isOpenAIRateLimitError,
} from "@/lib/openai-retry";

/**
 * Run claimed jobs after the HTTP response returns. Coolify cron and browser
 * kicks must not hold the request open for the full encode — disconnects were
 * aborting work while leaving leases stuck as `processing`.
 */
export function runClaimedMultiplierJobsInBackground(
  claimed: ClaimedProcessingJob[],
  opts?: { finalizeLimit?: number; logLabel?: string },
): void {
  const label = opts?.logLabel ?? "multiplier-worker";
  const finalizeLimit = opts?.finalizeLimit ?? 8;
  void (async () => {
    await Promise.all(
      claimed.map(async (job) => {
        try {
          const ran = await runMultiplierProcessingJob({
            jobId: job.id,
            userId: job.userId,
            payload: job.payload,
            attempts: job.attempts,
            leaseOwner: job.leaseOwner,
          });
          if (ran.ok && ran.shortPending) {
            await markProcessingJobAwaitingShort({
              id: job.id,
              leaseOwner: job.leaseOwner,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
            });
            return;
          }
          if (ran.ok) {
            await markProcessingJobDone({
              id: job.id,
              leaseOwner: job.leaseOwner,
            });
            return;
          }
          const rateLimited = isOpenAIRateLimitError(ran.error);
          const quota = isOpenAIQuotaError(ran.error);
          await markProcessingJobFailedOrRetry({
            id: job.id,
            leaseOwner: job.leaseOwner,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            error: ran.error,
            // Quota: fail via normal attempt burn (needs billing).
            // 429 RPM: re-queue without burning attempts.
            burnAttempt: quota || !rateLimited,
          });
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Multiplier worker crashed.";
          console.error(`[${label}] job ${job.id} crashed:`, message);
          const rateLimited = isOpenAIRateLimitError(e);
          const quota = isOpenAIQuotaError(e);
          try {
            await markProcessingJobFailedOrRetry({
              id: job.id,
              leaseOwner: job.leaseOwner,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
              error: message,
              burnAttempt: quota || !rateLimited,
            });
          } catch (markErr) {
            console.warn(
              `[${label}] failed to mark job ${job.id} after crash:`,
              markErr,
            );
          }
        }
      }),
    );
    try {
      await finalizeInFlightShortOutputs({ limit: finalizeLimit });
    } catch (e) {
      console.warn(`[${label}] short finalize failed:`, e);
    }
  })();
}

export { claimMultiplierProcessingJobs };
