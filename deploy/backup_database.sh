#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${THREADSGO_APP_DIR:-/opt/threadsai}"
BACKUP_DIR="${THREADSGO_BACKUP_DIR:-/var/backups/threadsgo}"
RETENTION_DAYS="${THREADSGO_BACKUP_RETENTION_DAYS:-14}"
SCREENSHOT_RETENTION_DAYS="${THREADSGO_SCREENSHOT_RETENTION_DAYS:-30}"
SOURCE_DB="${APP_DIR}/data/app.db"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TEMP_DB="${BACKUP_DIR}/app-${TIMESTAMP}.db"
ARCHIVE="${TEMP_DB}.gz"

install -d -m 0700 "${BACKUP_DIR}"
test -f "${SOURCE_DB}"

sqlite3 "${SOURCE_DB}" ".backup '${TEMP_DB}'"
sqlite3 "${TEMP_DB}" "PRAGMA quick_check;" | grep -qx "ok"
gzip -9 "${TEMP_DB}"
chmod 0600 "${ARCHIVE}"

find "${BACKUP_DIR}" -type f -name 'app-*.db.gz' -mtime "+${RETENTION_DAYS}" -delete

# Error screenshots are useful for diagnostics, but should not grow forever.
if [[ -d "${APP_DIR}/data/screenshots" ]]; then
    find "${APP_DIR}/data/screenshots" -type f -name '*_error.png' -mtime "+${SCREENSHOT_RETENTION_DAYS}" -delete
fi
