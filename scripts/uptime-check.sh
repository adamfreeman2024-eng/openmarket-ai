#!/usr/bin/env bash
# Uptime check — silent OK, exit 1 + message on failure (for cron email/alert)
set -euo pipefail
URL="${OPENMARKET_URL:-https://agentbazaar.app}"
code=$(curl -sS -o /tmp/om-ready.json -w "%{http_code}" --max-time 15 "$URL/api/v1/ready" || echo 000)
if [[ "$code" != "200" ]]; then
  echo "OPENMARKET DOWN ready_http=$code url=$URL $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat /tmp/om-ready.json 2>/dev/null || true
  exit 1
fi
status=$(python3 -c "import json;print(json.load(open('/tmp/om-ready.json')).get('status',''))" 2>/dev/null || echo "")
if [[ "$status" != "ready" ]]; then
  echo "OPENMARKET NOT READY status=$status $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat /tmp/om-ready.json
  exit 1
fi
exit 0
