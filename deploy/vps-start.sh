#!/usr/bin/env bash
# Run on VPS as root after clone + npm build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV=production
export PORT="${PORT:-3010}"
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://127.0.0.1:3010}"
export ALLOW_DEV_FAKE_SETTLEMENT="${ALLOW_DEV_FAKE_SETTLEMENT:-false}"
export OM_DATA_DIR="${OM_DATA_DIR:-$ROOT/data}"
export HEDERA_OPERATOR_ID="${HEDERA_OPERATOR_ID:-}"
export PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-200}"

mkdir -p "$OM_DATA_DIR"
npm ci --omit=dev
npm run build

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete openmarket-ai 2>/dev/null || true
  pm2 start ecosystem.config.cjs
  pm2 save
  echo "PM2 started openmarket-ai on :$PORT"
else
  echo "pm2 not found — starting with npm (foreground)"
  exec npm run start -- -H 0.0.0.0 -p "$PORT"
fi
