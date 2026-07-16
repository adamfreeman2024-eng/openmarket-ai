#!/usr/bin/env bash
# Cron: every 15m curl expire endpoint
# crontab: */15 * * * * /path/to/openmarket-ai/scripts/cron-expire.sh
set -euo pipefail
BASE="${OPENMARKET_URL:-http://127.0.0.1:3010}"
HDR=()
if [[ -n "${OPERATOR_API_KEY:-}" ]]; then
  HDR=(-H "x-operator-key: ${OPERATOR_API_KEY}")
fi
curl -sS -X POST "${BASE}/api/v1/escrow/expire" "${HDR[@]}" | tee /tmp/om-expire.json
echo
