-- AlterTable
ALTER TABLE "processing_jobs" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "processing_jobs" ADD COLUMN IF NOT EXISTS "max_attempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "processing_jobs" ADD COLUMN IF NOT EXISTS "leased_at" TIMESTAMPTZ;
ALTER TABLE "processing_jobs" ADD COLUMN IF NOT EXISTS "lease_owner" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "processing_jobs_job_type_status_created_at_idx"
  ON "processing_jobs"("job_type", "status", "created_at");
