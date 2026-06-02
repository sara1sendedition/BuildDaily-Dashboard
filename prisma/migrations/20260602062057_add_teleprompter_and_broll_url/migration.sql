-- Studio pilot readiness: columns Studio needs to round-trip through the
-- unified DB before NEXT_PUBLIC_STORAGE_PROVIDER is flipped to hub-api.
-- Both are additive + nullable → safe, no backfill, no data loss.

-- Per-project teleprompter preferences (Studio Project.teleprompterSettings).
ALTER TABLE "projects" ADD COLUMN "teleprompter_settings" JSONB;

-- Playable URL for a b-roll clip (Studio BrollClip.url) — Bunny playback URL
-- or the legacy Supabase public URL during transition.
ALTER TABLE "broll_library" ADD COLUMN "url" TEXT;
