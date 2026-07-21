#!/usr/bin/env bash
# OpenMarket production backup — Postgres + file data dir
# Usage: ./scripts/backup.sh [outdir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT/om-backup-$STAMP"
mkdir -p "$DEST"

echo "==> OpenMarket backup $STAMP"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# File store (Docker volume path or local data/)
if docker compose -f "$ROOT/docker-compose.yml" ps --status running 2>/dev/null | grep -q openmarket; then
  echo "--> dumping app /data from container"
  docker compose -f "$ROOT/docker-compose.yml" exec -T openmarket \
    sh -c 'cd /data && tar czf - .' > "$DEST/data.tar.gz" || true
  echo "--> pg_dump"
  docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-openmarket}" "${POSTGRES_DB:-openmarket}" \
    > "$DEST/postgres.sql" || true
else
  if [[ -d "$ROOT/data" ]]; then
    tar czf "$DEST/data.tar.gz" -C "$ROOT/data" .
  fi
  if [[ -n "${DATABASE_URL:-}" ]]; then
    pg_dump "$DATABASE_URL" > "$DEST/postgres.sql" || true
  fi
fi

# Non-secret config snapshot
{
  echo "backup_at=$STAMP"
  echo "site=${NEXT_PUBLIC_SITE_URL:-}"
  echo "network=${NEXT_PUBLIC_HEDERA_NETWORK:-}"
  echo "escrow=${ESCROW_CONTRACT_ADDRESS:-}"
  echo "usdc=${USDC_TOKEN_ID:-}"
  echo "operator_id=${HEDERA_OPERATOR_ID:-}"
} > "$DEST/meta.env"

cd "$OUT"
tar czf "om-backup-$STAMP.tar.gz" "om-backup-$STAMP"
rm -rf "$DEST"
echo "==> wrote $OUT/om-backup-$STAMP.tar.gz"
ls -lh "$OUT/om-backup-$STAMP.tar.gz"
