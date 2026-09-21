#!/usr/bin/env bash
#
# Nightly logical backup of the Planner database.
#
# Run by planner-backup.timer. Reads DATABASE_URL and STORAGE_* from the API's
# .env so there is one place to rotate credentials.
#
# Two stages, and the first never depends on the second: a verified local dump
# is taken every night regardless, and it is copied offsite only when object
# storage is actually configured. That ordering is deliberate — a backup job
# that fails outright because the offsite leg is unavailable produces no backup
# at all, which is strictly worse than a local one.
#
# Before this file, this server had no automated database backups of any kind:
# three production products, one unreplicated disk, and a single manual dump
# from May 2026. The other four databases still need the same treatment.
set -euo pipefail

# This host has an incomplete locale configuration, so every `sudo -u postgres`
# call emits a block of perl warnings that buries the real output. Pin it.
export LC_ALL=C LANG=C

ENV_FILE="${ENV_FILE:-/var/www/planner-api/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

DB_NAME="${PLANNER_DB_NAME:-planner}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
LOCAL_DIR="${BACKUP_DIR:-/var/backups/planner}"
BUCKET="${BACKUP_BUCKET:-${STORAGE_BUCKET:-}}"
PREFIX="${BACKUP_PREFIX:-backups/planner}"

mkdir -p "$LOCAL_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$LOCAL_DIR/${DB_NAME}-${STAMP}.dump"

echo "Dumping ${DB_NAME}…"
# Custom format: compressed, and restorable table-by-table with pg_restore.
# Run as the postgres superuser via peer auth, so this job needs no password
# and is unaffected by the pg_hba rule confining the application's role.
#
# pg_dump writes to stdout and the shell redirects as root. Passing --file
# would make pg_dump itself create the file *as the postgres user*, which
# cannot write to a root-owned backup directory — and widening that directory's
# permissions to work around it would be the wrong trade for a file containing
# every row the product holds.
umask 077
sudo -u postgres pg_dump --format=custom --no-owner "$DB_NAME" > "$DUMP"
chmod 600 "$DUMP"

# A backup that has never been read back is a hypothesis, not a backup.
echo "Verifying the dump is readable…"
# Read back as root: --list only parses the file, it opens no connection.
TABLES="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
echo "  $(du -h "$DUMP" | cut -f1), ${TABLES} tables with data"

# ── Offsite ─────────────────────────────────────────────────────────────────
if [ -z "${STORAGE_ENDPOINT:-}" ] || [ -z "${STORAGE_ACCESS_KEY:-}" ] || [ -z "$BUCKET" ]; then
  echo "WARNING: object storage is not configured — this backup is LOCAL ONLY."
  echo "         It is on the same unreplicated disk as the database it protects."
  echo "         Set STORAGE_* in $ENV_FILE to enable offsite copies."
elif ! command -v aws >/dev/null 2>&1; then
  echo "WARNING: the aws CLI is not installed — this backup is LOCAL ONLY."
  echo "         Install it (apt-get install -y awscli) to enable offsite copies."
else
  echo "Uploading to object storage…"
  AWS_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$STORAGE_SECRET_KEY" \
  aws s3 cp "$DUMP" "s3://${BUCKET}/${PREFIX}/$(basename "$DUMP")" \
    --endpoint-url "$STORAGE_ENDPOINT" \
    --only-show-errors
  echo "  uploaded to s3://${BUCKET}/${PREFIX}/$(basename "$DUMP")"
fi

echo "Pruning local dumps older than ${RETAIN_DAYS} days…"
find "$LOCAL_DIR" -name "${DB_NAME}-*.dump" -mtime "+${RETAIN_DAYS}" -delete

echo "Backup complete: $(basename "$DUMP")"
