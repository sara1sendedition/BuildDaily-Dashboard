-- AlterTable
ALTER TABLE "social_connections" ADD COLUMN IF NOT EXISTS "external_display_name" TEXT;
ALTER TABLE "social_connections" ADD COLUMN IF NOT EXISTS "external_avatar_url" TEXT;
