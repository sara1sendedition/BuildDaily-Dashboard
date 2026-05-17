#!/usr/bin/env bash
#
# Starts Video to Short (FastAPI on :8000) + this Next.js app (default :3002),
# then opens Google Chrome to the studio. For a Dock / double-click launcher,
# use scripts/StartVideoStudio.command (macOS).
#
# Optional env:
#   VIDEO_SHORT_BACKEND  — path to Video to Short backend (default: sibling folder)
#   SHORT_PORT           — default 8000
#   NEXT_PORT            — default 3002
#   SKIP_CHROME=1        — do not open a browser
#
set -euo pipefail

# Finder-launched .command shells often have a minimal PATH; Homebrew Node lives here.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHORT_PORT="${SHORT_PORT:-8000}"
NEXT_PORT="${NEXT_PORT:-3002}"
CHROME_URL="http://127.0.0.1:${NEXT_PORT}/"

DEFAULT_SHORT="$(cd "$STUDIO_ROOT/../Video to Short/backend" 2>/dev/null && pwd || true)"
SHORT_BACKEND="${VIDEO_SHORT_BACKEND:-$DEFAULT_SHORT}"

log() { printf '%s\n' "$*"; }

wait_http() {
  local url="$1" label="$2" max_attempts="${3:-90}"
  local i=0
  while (( i < max_attempts )); do
    if curl -sf -o /dev/null "$url"; then
      log "OK: $label is up ($url)"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  log "ERROR: $label did not respond within ${max_attempts}s ($url)"
  return 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "Warning: This script is tuned for macOS (Chrome via \`open\`)."
fi

# --- Video to Short API ---
if curl -sf -o /dev/null "http://127.0.0.1:${SHORT_PORT}/docs" 2>/dev/null; then
  log "Video to Short: already listening on port ${SHORT_PORT} (skip start)."
else
  if [[ ! -d "$SHORT_BACKEND" ]]; then
    log "ERROR: Video to Short backend not found at:"
    log "  $SHORT_BACKEND"
    log "Set VIDEO_SHORT_BACKEND to your backend path, or place the repo next to this one:"
    log "  Cursor/Video to Short/backend"
    exit 1
  fi
  if [[ -x "$SHORT_BACKEND/.venv/bin/uvicorn" ]]; then
    UVICORN="$SHORT_BACKEND/.venv/bin/uvicorn"
  elif command -v uvicorn >/dev/null 2>&1; then
    UVICORN="uvicorn"
  else
    log "ERROR: uvicorn not found. Activate the Short backend venv or install uvicorn."
    exit 1
  fi
  log "Starting Video to Short API (port ${SHORT_PORT})…"
  (
    cd "$SHORT_BACKEND"
    exec "$UVICORN" app.main:app --host 127.0.0.1 --port "$SHORT_PORT"
  ) >>/tmp/video-to-short-api.log 2>&1 &
  echo $! >/tmp/video-to-short-api.pid
  wait_http "http://127.0.0.1:${SHORT_PORT}/docs" "Video to Short API" 90
fi

# --- Next.js (Content Multiplier) ---
if curl -sf -o /dev/null "http://127.0.0.1:${NEXT_PORT}/" 2>/dev/null; then
  log "Next.js: already responding on port ${NEXT_PORT} (skip start)."
else
  if ! command -v npm >/dev/null 2>&1; then
    log "ERROR: npm not on PATH."
    exit 1
  fi
  log "Starting Next.js dev server (port ${NEXT_PORT})…"
  (
    cd "$STUDIO_ROOT"
    exec npm run dev -- -p "$NEXT_PORT"
  ) >>/tmp/video-studio-next.log 2>&1 &
  echo $! >/tmp/video-studio-next.pid
  wait_http "http://127.0.0.1:${NEXT_PORT}/" "Next.js dev" 120
fi

# --- Chrome ---
if [[ "${SKIP_CHROME:-0}" == "1" ]]; then
  log "SKIP_CHROME=1 — not opening a browser."
  exit 0
fi

if [[ -d "/Applications/Google Chrome.app" ]]; then
  log "Opening Google Chrome → ${CHROME_URL}"
  open -a "Google Chrome" "$CHROME_URL"
else
  log "Google Chrome not found in /Applications; opening default browser."
  open "$CHROME_URL"
fi

log ""
log "Logs: /tmp/video-to-short-api.log  /  /tmp/video-studio-next.log"
log "PIDs:  /tmp/video-to-short-api.pid  /  /tmp/video-studio-next.pid"
log "Stop:  kill \$(cat /tmp/video-to-short-api.pid) 2>/dev/null; kill \$(cat /tmp/video-studio-next.pid) 2>/dev/null"
