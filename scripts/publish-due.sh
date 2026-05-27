#!/usr/bin/env bash
# POST /api/schedule/publish-due — run from launchd/cron every ~5 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${NEXT_PORT:-3002}"
BASE_URL="${PUBLISH_DUE_BASE_URL:-http://127.0.0.1:${PORT}}"

if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi

SECRET="${SCHEDULE_DAEMON_SECRET:-}"
if [[ -z "$SECRET" ]]; then
  echo "publish-due: SCHEDULE_DAEMON_SECRET is not set (.env.local or env)." >&2
  exit 1
fi

curl -sf -X POST "${BASE_URL%/}/api/schedule/publish-due" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 320
