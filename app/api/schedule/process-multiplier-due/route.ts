import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import {
  backfillFailedShortCreates,
  backfillStuckMultiplierProcessingJobs,
} from "@/lib/multiplier/backfill-stuck-jobs";
import { runClaimedMultiplierJobsInBackground } from "@/lib/multiplier/run-claimed-jobs-background";
import { claimMultiplierProcessingJobs } from "@/lib/multiplier/claim-processing-jobs";

export const runtime = "nodejs";
export const maxDuration = 1800;

function concurrency(): number {
  const raw = Number(
    process.env.MULTIPLIER_PROCESS_CONCURRENCY?.trim() || "3",
  );
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(5, Math.floor(raw)));
}

/**
 * POST /api/schedule/process-multiplier-due
 *
 * Cron tick: backfill stuck rows, claim up to N jobs, start them in the
 * background, return immediately so Coolify's curl does not abort mid-encode.
 */
export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  const leaseOwner = `process-multiplier-due:${process.pid}:${Date.now()}`;
  const limit = concurrency();

  let backfill = { scanned: 0, created: 0, skipped: 0 };
  let shortBackfill = { scanned: 0, created: 0, skipped: 0 };
  try {
    backfill = await backfillStuckMultiplierProcessingJobs({ limit: 12 });
  } catch (e) {
    console.warn("[process-multiplier-due] backfill failed:", e);
  }
  try {
    shortBackfill = await backfillFailedShortCreates({ limit: 8 });
  } catch (e) {
    console.warn("[process-multiplier-due] short backfill failed:", e);
  }

  let claimed;
  try {
    claimed = await claimMultiplierProcessingJobs({ limit, leaseOwner });
  } catch (e) {
    console.error("[process-multiplier-due] claim failed:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Failed to claim multiplier processing jobs.",
      },
      { status: 500 },
    );
  }

  runClaimedMultiplierJobsInBackground(claimed, {
    finalizeLimit: 5,
    logLabel: "process-multiplier-due",
  });

  return NextResponse.json({
    data: {
      claimed: claimed.length,
      concurrency: limit,
      started: true,
      backfill,
      shortBackfill,
    },
  });
}
