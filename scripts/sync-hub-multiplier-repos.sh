#!/usr/bin/env bash
# Bidirectional sync between ContentMultiplier and BuildDaily Dashboard (hub app).
set -euo pipefail

CM="/Users/sarawadework/Cursor/Video to scheduled post"
HUB="$HOME/Cursor/BuildDaily Dashboard"

RSYNC_EX=(
  --archive
  --exclude node_modules
  --exclude .git
  --exclude .next
  --exclude .DS_Store
  --exclude .data
  --exclude .env
  --exclude '*.log'
  --exclude '*.command'
)

echo "=== ContentMultiplier → BuildDaily Dashboard (multiplier features) ==="

# Hub-only paths: preserve in BuildDaily Dashboard (do not delete via rsync --delete).
HUB_PRESERVE=(
  app/api/v1
  app/api/schedule/daemon-delete
  app/api/schedule/daemon-status
  app/api/schedule/daemon-upsert
  app/api/schedule/daemon-upsert-reel
  lib/auth
  lib/internal-auth.ts
  lib/prisma.ts
  lib/schedule/daemon-reel-storage.ts
  lib/schedule/daemon-store.ts
  lib/storage/bunny-adapter.ts
  lib/storage/contracts.ts
  prisma
  scripts/com.videostudio.publish-due.plist
  scripts/StartVideoStudio.command
)

HUB_RSYNC_EX=("${RSYNC_EX[@]}")
for p in "${HUB_PRESERVE[@]}"; do
  HUB_RSYNC_EX+=(--exclude "$p")
done

rsync "${HUB_RSYNC_EX[@]}" "$CM/app/" "$HUB/app/"
rsync "${HUB_RSYNC_EX[@]}" "$CM/lib/" "$HUB/lib/"
rsync "${HUB_RSYNC_EX[@]}" "$CM/context/" "$HUB/context/"
rsync "${HUB_RSYNC_EX[@]}" "$CM/docs/" "$HUB/docs/"
rsync "${HUB_RSYNC_EX[@]}" "$CM/scripts/" "$HUB/scripts/"

cp "$CM/middleware.ts" "$HUB/middleware.ts.pending"
cp "$CM/next.config.ts" "$HUB/next.config.ts"
cp "$CM/tsconfig.json" "$HUB/tsconfig.json" 2>/dev/null || true

echo "=== BuildDaily Dashboard → ContentMultiplier (hub backend) ==="

rsync "${RSYNC_EX[@]}" "$HUB/app/api/v1/" "$CM/app/api/v1/"
rsync "${RSYNC_EX[@]}" "$HUB/app/api/schedule/daemon-delete/" "$CM/app/api/schedule/daemon-delete/"
rsync "${RSYNC_EX[@]}" "$HUB/app/api/schedule/daemon-status/" "$CM/app/api/schedule/daemon-status/"
rsync "${RSYNC_EX[@]}" "$HUB/app/api/schedule/daemon-upsert/" "$CM/app/api/schedule/daemon-upsert/"
rsync "${RSYNC_EX[@]}" "$HUB/app/api/schedule/daemon-upsert-reel/" "$CM/app/api/schedule/daemon-upsert-reel/"
rsync "${RSYNC_EX[@]}" "$HUB/lib/auth/" "$CM/lib/auth/"
rsync "${RSYNC_EX[@]}" "$HUB/lib/internal-auth.ts" "$CM/lib/internal-auth.ts"
rsync "${RSYNC_EX[@]}" "$HUB/lib/prisma.ts" "$CM/lib/prisma.ts"
rsync "${RSYNC_EX[@]}" "$HUB/lib/schedule/daemon-reel-storage.ts" "$CM/lib/schedule/daemon-reel-storage.ts"
rsync "${RSYNC_EX[@]}" "$HUB/lib/schedule/daemon-store.ts" "$CM/lib/schedule/daemon-store.ts"
rsync "${RSYNC_EX[@]}" "$HUB/lib/storage/bunny-adapter.ts" "$CM/lib/storage/bunny-adapter.ts"
rsync "${RSYNC_EX[@]}" "$HUB/lib/storage/contracts.ts" "$CM/lib/storage/contracts.ts"
rsync "${RSYNC_EX[@]}" "$HUB/prisma/" "$CM/prisma/"
rsync "${RSYNC_EX[@]}" "$HUB/scripts/com.videostudio.publish-due.plist" "$CM/scripts/com.videostudio.publish-due.plist"
rsync "${RSYNC_EX[@]}" "$HUB/scripts/StartVideoStudio.command" "$CM/scripts/StartVideoStudio.command"

echo "=== Done. Apply merged middleware/package.json/.env.example manually. ==="
