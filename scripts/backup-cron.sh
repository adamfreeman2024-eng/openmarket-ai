#!/usr/bin/env bash
# OpenMarket nightly backup + Telegram alert on failure.
# Install: crontab -e  →  0 2 * * * /root/projects/openmarket-ai/scripts/backup-cron.sh >> /root/projects/openmarket-ai/backups/cron.log 2>&1
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/backups"

# Load env for TELEGRAM_* credentials
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() { echo "[$(ts)] $*"; }

send_alert() {
  local text="$1"
  local token="${TELEGRAM_BOT_TOKEN:-}"
  local chat="${TELEGRAM_CHAT_ID:-}"
  [[ -z "$token" || -z "$chat" ]] && { log "Telegram env missing — skip alert"; return 0; }
  curl -s -m 15 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -H "content-type: application/json" \
    -d "{\"chat_id\":${chat},\"text\":\"[OpenMarket backup] ${text}\"}" >/dev/null 2>&1
}

# Rotate: keep last 14 backups
find "$OUT" -maxdepth 1 -type d -name 'om-backup-*' -mtime +14 -exec rm -rf {} + 2>/dev/null

if "$ROOT/scripts/backup.sh" "$OUT" > "$OUT/cron-run.log" 2>&1; then
  send_alert "OK $(ts) — backup finished"
  log "backup OK"
else
  send_alert "FAIL $(ts) — see $OUT/cron-run.log"
  log "backup FAILED (see $OUT/cron-run.log)"
  exit 1
fi
