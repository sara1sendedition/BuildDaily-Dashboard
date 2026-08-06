import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_MULTIPLIER_MAX_ATTEMPTS,
  MULTIPLIER_JOB_TYPE,
} from "@/lib/multiplier/process-job-types";

/** Recover after deploys kill background workers; heartbeats renew sooner. */
const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export type ClaimedProcessingJob = {
  id: string;
  userId: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
};

/**
 * Atomically claim up to `limit` pending (or stale-leased) multiplier jobs.
 *
 * Uses FOR UPDATE SKIP LOCKED inside one statement so overlapping cron +
 * browser kicks cannot stampede past the concurrency cap.
 */
export async function claimMultiplierProcessingJobs(opts: {
  limit: number;
  leaseOwner: string;
  userId?: string;
  leaseMs?: number;
}): Promise<ClaimedProcessingJob[]> {
  const limit = Math.max(1, Math.min(5, Math.floor(opts.limit)));
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const staleBefore = new Date(Date.now() - leaseMs);
  const userFilter = opts.userId
    ? Prisma.sql`AND user_id = ${opts.userId}`
    : Prisma.empty;

  // Serialize claimers so two overlapping ticks cannot each see active=0 and
  // claim a full `limit` (SKIP LOCKED alone does not protect the active count).
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      user_id: string;
      payload: unknown;
      attempts: number;
      max_attempts: number;
      lease_owner: string | null;
    }>
  >`
    WITH
    lock AS (
      SELECT pg_advisory_xact_lock(87231401)
    ),
    active AS (
      SELECT count(*)::int AS n
      FROM processing_jobs, lock
      WHERE job_type = ${MULTIPLIER_JOB_TYPE}
        AND status = 'processing'
        AND leased_at IS NOT NULL
        AND leased_at > ${staleBefore}
        ${userFilter}
    ),
    picked AS (
      SELECT id
      FROM processing_jobs
      WHERE job_type = ${MULTIPLIER_JOB_TYPE}
        ${userFilter}
        AND (
          status = 'pending'
          OR (
            status = 'processing'
            AND (leased_at IS NULL OR leased_at < ${staleBefore})
          )
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(0, ${limit} - (SELECT n FROM active))
    )
    UPDATE processing_jobs AS pj
    SET
      status = 'processing',
      leased_at = NOW(),
      lease_owner = ${opts.leaseOwner},
      error = NULL
    FROM picked
    WHERE pj.id = picked.id
    RETURNING
      pj.id,
      pj.user_id,
      pj.payload,
      pj.attempts,
      pj.max_attempts,
      pj.lease_owner
  `;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts || DEFAULT_MULTIPLIER_MAX_ATTEMPTS,
    leaseOwner: row.lease_owner ?? opts.leaseOwner,
  }));
}

/** Heartbeat so long carousel/Short runs are not stolen mid-job. */
export async function renewProcessingJobLease(opts: {
  id: string;
  leaseOwner: string;
}): Promise<boolean> {
  const updated = await prisma.processingJob.updateMany({
    where: {
      id: opts.id,
      status: "processing",
      leaseOwner: opts.leaseOwner,
    },
    data: { leasedAt: new Date() },
  });
  return updated.count > 0;
}

/**
 * Mark done only if this worker still owns the lease (stolen leases no-op).
 */
export async function markProcessingJobDone(opts: {
  id: string;
  leaseOwner: string;
}): Promise<boolean> {
  const updated = await prisma.processingJob.updateMany({
    where: {
      id: opts.id,
      status: "processing",
      leaseOwner: opts.leaseOwner,
    },
    data: {
      status: "done",
      processedAt: new Date(),
      leasedAt: null,
      leaseOwner: null,
      error: null,
    },
  });
  return updated.count > 0;
}

/**
 * Re-queue without burning attempts when carousel/photo finished but Short is
 * still encoding on the Video-to-Short server. A later tick resumes / finalizes.
 */
export async function markProcessingJobAwaitingShort(opts: {
  id: string;
  leaseOwner: string;
  attempts: number;
  maxAttempts: number;
}): Promise<"retried" | "ignored"> {
  return markProcessingJobFailedOrRetry({
    id: opts.id,
    leaseOwner: opts.leaseOwner,
    attempts: opts.attempts,
    maxAttempts: opts.maxAttempts,
    error: "Awaiting Short encode…",
    burnAttempt: false,
  }).then((r) => (r === "ignored" ? "ignored" : "retried"));
}

export async function markProcessingJobFailedOrRetry(opts: {
  id: string;
  leaseOwner: string;
  attempts: number;
  maxAttempts: number;
  error: string;
  /** When false, re-queue without burning an attempt (e.g. OpenAI 429). */
  burnAttempt?: boolean;
}): Promise<"retried" | "failed" | "ignored"> {
  const burn = opts.burnAttempt !== false;
  const nextAttempts = burn ? opts.attempts + 1 : opts.attempts;
  const stillOwned = {
    id: opts.id,
    status: "processing" as const,
    leaseOwner: opts.leaseOwner,
  };

  // Rate-limit / transient: always re-pend without burning attempts.
  if (!burn || nextAttempts < opts.maxAttempts) {
    const updated = await prisma.processingJob.updateMany({
      where: stillOwned,
      data: {
        status: "pending",
        attempts: nextAttempts,
        error: opts.error.slice(0, 2000),
        leasedAt: null,
        leaseOwner: null,
        processedAt: null,
      },
    });
    return updated.count === 0 ? "ignored" : "retried";
  }

  const updated = await prisma.processingJob.updateMany({
    where: stillOwned,
    data: {
      status: "failed",
      attempts: nextAttempts,
      error: opts.error.slice(0, 2000),
      processedAt: new Date(),
      leasedAt: null,
      leaseOwner: null,
    },
  });
  return updated.count === 0 ? "ignored" : "failed";
}
