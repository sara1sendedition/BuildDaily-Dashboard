-- CreateTable
CREATE TABLE "multiplier_queue_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "kind" TEXT,
    "video_label" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "multiplier_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "multiplier_queue_items_user_id_created_at_idx" ON "multiplier_queue_items"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "multiplier_queue_items_user_id_status_idx" ON "multiplier_queue_items"("user_id", "status");

-- AddForeignKey
ALTER TABLE "multiplier_queue_items" ADD CONSTRAINT "multiplier_queue_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
