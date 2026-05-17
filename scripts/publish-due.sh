#!/usr/bin/env bash
# Called by launchd every 5 minutes. Publishes calendar rows whose time is due (immediate Meta publish).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load SCHEDULE_DAEMON_SECRET / NEXT_PORT from project .env (no secret in the plist).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Default 3002 matches this repo’s dev port (leave another app on 3000). Override with NEXT_PORT in .env.
PORT="${NEXT_PORT:-3002}"
URL="http://127.0.0.1:${PORT}/api/schedule/publish-due"

if [[ -z "${SCHEDULE_DAEMON_SECRET:-}" ]]; then
  echo "ERROR: SCHEDULE_DAEMON_SECRET missing in .env (same value as NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET)." >&2
  exit 1
fi

curl -sS -X POST "$URL" \
  -H "Authorization: Bearer ${SCHEDULE_DAEMON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}' | tee /tmp/video-studio-publish-due-last.json

echo ""
