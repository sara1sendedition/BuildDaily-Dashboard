-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'FACEBOOK');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "timezone" TEXT,
    "display_name" TEXT,
    "membership_type" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "business_type" TEXT,
    "business_description" TEXT,
    "value_props" TEXT,
    "boundaries" TEXT,
    "audience_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brief_combined_text" TEXT,
    "copy_context" TEXT,
    "copy_feedback" TEXT,
    "default_caption_cta" TEXT,
    "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "funnel_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_personas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brand_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "primary_audience" TEXT,
    "audience_details" TEXT,
    "voice_and_tone" TEXT,
    "audience_pains" TEXT,
    "believer_persona" TEXT,
    "skeptic_persona" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "audience_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_documents" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'bunny-storage',
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT,
    "extracted_text" TEXT,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "cta" TEXT,
    "price_cents" INTEGER,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "content" TEXT NOT NULL,
    "source_label" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visual_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "kind" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "thumbnail_storage_path" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "visual_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learned_from_edits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "before_line" TEXT NOT NULL,
    "after_line" TEXT NOT NULL,
    "context" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learned_from_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "scopes" TEXT[],
    "external_user_id" TEXT,
    "external_username" TEXT,
    "webhook_secret" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "schedule_kind" TEXT NOT NULL,
    "publish_at" TIMESTAMPTZ NOT NULL,
    "payload" JSONB NOT NULL,
    "reel_video_stored" BOOLEAN NOT NULL DEFAULT false,
    "posted_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_performance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "schedule_entry_id" TEXT,
    "platform" TEXT NOT NULL,
    "external_post_url" TEXT,
    "external_post_id" TEXT,
    "views" BIGINT,
    "impressions" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "retention_pct" DECIMAL,
    "avg_watch_seconds" DECIMAL,
    "engagement_rate" DECIMAL,
    "raw_metrics" JSONB,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "brand_id" TEXT,
    "brand_name" TEXT,
    "segment_prompts" JSONB NOT NULL DEFAULT '[]',
    "quick_plan_schedule" JSONB,
    "video_style_defaults" JSONB,
    "video_orientation" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broll_library" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'bunny-stream',
    "storage_path" TEXT NOT NULL,
    "duration_seconds" DECIMAL NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broll_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "url" TEXT,
    "published_at" TIMESTAMPTZ,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commenter_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "follower_count" INTEGER,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "commenter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "commenter_profile_id" TEXT,
    "platform" "Platform" NOT NULL,
    "external_id" TEXT NOT NULL,
    "parent_external_id" TEXT,
    "text" TEXT NOT NULL,
    "author_handle" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,
    "raw_payload" JSONB,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classifications" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "model_id" TEXT NOT NULL,
    "prompt_hash" TEXT,
    "intent_tier" TEXT NOT NULL,
    "intent_score" DECIMAL NOT NULL,
    "sentiment" TEXT NOT NULL,
    "is_spam" BOOLEAN NOT NULL DEFAULT false,
    "is_toxic" BOOLEAN NOT NULL DEFAULT false,
    "is_question" BOOLEAN NOT NULL DEFAULT false,
    "primary_topic" TEXT,
    "persona_hint" TEXT,
    "suggested_next_step" TEXT,
    "relationship_value" TEXT NOT NULL DEFAULT 'medium',
    "reply_goal" TEXT NOT NULL DEFAULT 'engage',
    "intent_segment" TEXT,
    "priority_score" DECIMAL NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "raw_dimensions" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_view_states" (
    "comment_id" TEXT NOT NULL,
    "surfaced" BOOLEAN NOT NULL DEFAULT true,
    "needs_response" BOOLEAN NOT NULL DEFAULT false,
    "conversion_ready" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "snoozed_until" TIMESTAMPTZ,
    "priority_rank" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inbox_view_states_pkey" PRIMARY KEY ("comment_id")
);

-- CreateTable
CREATE TABLE "draft_replies" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "classification_version" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcome_events" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "draft_reply_id" TEXT,
    "event_type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outcome_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "title" TEXT,
    "source_text" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_import_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "video_title" TEXT,
    "viewer_comment_text" TEXT NOT NULL,
    "creator_reply_text" TEXT NOT NULL,
    "creator_reply_youtube_id" TEXT NOT NULL,
    "reply_published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "question_cluster" TEXT NOT NULL,
    "canonical_question" TEXT NOT NULL,
    "approved_reply" TEXT,
    "reply_goal" TEXT NOT NULL,
    "suggested_next_step" TEXT,
    "times_seen" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avg_sentiment" DECIMAL NOT NULL DEFAULT 0,
    "best_performing_reply" TEXT,
    "topic" TEXT,
    "platforms" JSONB,
    "related_videos" JSONB,
    "sample_comments" JSONB,
    "intent_mix" JSONB,
    "embedding" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reply_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "work_dir" TEXT,
    "result_provider" TEXT,
    "result_path" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "trace_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "brands_user_id_idx" ON "brands"("user_id");

-- CreateIndex
CREATE INDEX "brands_industry_idx" ON "brands"("industry");

-- CreateIndex
CREATE INDEX "audience_personas_brand_id_idx" ON "audience_personas"("brand_id");

-- CreateIndex
CREATE INDEX "brand_documents_brand_id_idx" ON "brand_documents"("brand_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "reference_sources_user_id_idx" ON "reference_sources"("user_id");

-- CreateIndex
CREATE INDEX "reference_sources_brand_id_idx" ON "reference_sources"("brand_id");

-- CreateIndex
CREATE INDEX "visual_references_user_id_kind_idx" ON "visual_references"("user_id", "kind");

-- CreateIndex
CREATE INDEX "learned_from_edits_user_id_created_at_idx" ON "learned_from_edits"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "social_connections_user_id_idx" ON "social_connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_user_id_platform_key" ON "social_connections"("user_id", "platform");

-- CreateIndex
CREATE INDEX "schedule_entries_publish_at_idx" ON "schedule_entries"("publish_at");

-- CreateIndex
CREATE INDEX "schedule_entries_user_id_publish_at_idx" ON "schedule_entries"("user_id", "publish_at");

-- CreateIndex
CREATE INDEX "post_performance_user_id_idx" ON "post_performance"("user_id");

-- CreateIndex
CREATE INDEX "post_performance_brand_id_idx" ON "post_performance"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_performance_user_id_schedule_entry_id_platform_key" ON "post_performance"("user_id", "schedule_entry_id", "platform");

-- CreateIndex
CREATE INDEX "projects_user_id_idx" ON "projects"("user_id");

-- CreateIndex
CREATE INDEX "projects_brand_id_idx" ON "projects"("brand_id");

-- CreateIndex
CREATE INDEX "day_records_project_id_date_idx" ON "day_records"("project_id", "date");

-- CreateIndex
CREATE INDEX "day_records_user_id_idx" ON "day_records"("user_id");

-- CreateIndex
CREATE INDEX "challenge_enrollments_user_id_idx" ON "challenge_enrollments"("user_id");

-- CreateIndex
CREATE INDEX "challenge_enrollments_project_id_idx" ON "challenge_enrollments"("project_id");

-- CreateIndex
CREATE INDEX "broll_library_user_id_idx" ON "broll_library"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_user_id_platform_external_id_key" ON "content_items"("user_id", "platform", "external_id");

-- CreateIndex
CREATE INDEX "commenter_profiles_user_id_idx" ON "commenter_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "commenter_profiles_user_id_platform_handle_key" ON "commenter_profiles"("user_id", "platform", "handle");

-- CreateIndex
CREATE INDEX "comments_user_id_published_at_idx" ON "comments"("user_id", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "comments_user_id_platform_external_id_key" ON "comments"("user_id", "platform", "external_id");

-- CreateIndex
CREATE INDEX "classifications_comment_id_version_idx" ON "classifications"("comment_id", "version" DESC);

-- CreateIndex
CREATE INDEX "draft_replies_comment_id_idx" ON "draft_replies"("comment_id");

-- CreateIndex
CREATE INDEX "outcome_events_comment_id_event_type_idx" ON "outcome_events"("comment_id", "event_type");

-- CreateIndex
CREATE INDEX "voice_documents_user_id_idx" ON "voice_documents"("user_id");

-- CreateIndex
CREATE INDEX "voice_documents_brand_id_idx" ON "voice_documents"("brand_id");

-- CreateIndex
CREATE INDEX "voice_chunks_document_id_chunk_index_idx" ON "voice_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "voice_import_items_user_id_idx" ON "voice_import_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_import_items_user_id_creator_reply_youtube_id_key" ON "voice_import_items"("user_id", "creator_reply_youtube_id");

-- CreateIndex
CREATE INDEX "reply_memories_user_id_question_cluster_idx" ON "reply_memories"("user_id", "question_cluster");

-- CreateIndex
CREATE INDEX "reply_memories_user_id_times_seen_idx" ON "reply_memories"("user_id", "times_seen" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "video_jobs_correlation_id_key" ON "video_jobs"("correlation_id");

-- CreateIndex
CREATE INDEX "video_jobs_status_created_at_idx" ON "video_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "video_jobs_user_id_created_at_idx" ON "video_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "processing_jobs_status_created_at_idx" ON "processing_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "processing_jobs_user_id_status_idx" ON "processing_jobs"("user_id", "status");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_personas" ADD CONSTRAINT "audience_personas_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_documents" ADD CONSTRAINT "brand_documents_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_sources" ADD CONSTRAINT "reference_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_sources" ADD CONSTRAINT "reference_sources_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visual_references" ADD CONSTRAINT "visual_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visual_references" ADD CONSTRAINT "visual_references_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learned_from_edits" ADD CONSTRAINT "learned_from_edits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learned_from_edits" ADD CONSTRAINT "learned_from_edits_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_performance" ADD CONSTRAINT "post_performance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_performance" ADD CONSTRAINT "post_performance_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_performance" ADD CONSTRAINT "post_performance_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "schedule_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_records" ADD CONSTRAINT "day_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_records" ADD CONSTRAINT "day_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_enrollments" ADD CONSTRAINT "challenge_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_enrollments" ADD CONSTRAINT "challenge_enrollments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broll_library" ADD CONSTRAINT "broll_library_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commenter_profiles" ADD CONSTRAINT "commenter_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_commenter_profile_id_fkey" FOREIGN KEY ("commenter_profile_id") REFERENCES "commenter_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_view_states" ADD CONSTRAINT "inbox_view_states_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_replies" ADD CONSTRAINT "draft_replies_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_events" ADD CONSTRAINT "outcome_events_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_events" ADD CONSTRAINT "outcome_events_draft_reply_id_fkey" FOREIGN KEY ("draft_reply_id") REFERENCES "draft_replies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_documents" ADD CONSTRAINT "voice_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_documents" ADD CONSTRAINT "voice_documents_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_chunks" ADD CONSTRAINT "voice_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "voice_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_import_items" ADD CONSTRAINT "voice_import_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_memories" ADD CONSTRAINT "reply_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_memories" ADD CONSTRAINT "reply_memories_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
