-- Soft publish lock: claim without marking the post as successfully posted.
ALTER TABLE "schedule_entries"
  ADD COLUMN IF NOT EXISTS "publish_claimed_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "schedule_entries_publish_claimed_at_idx"
  ON "schedule_entries"("publish_claimed_at");
