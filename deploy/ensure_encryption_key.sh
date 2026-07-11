#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${THREADSGO_APP_DIR:-/opt/threadsai}"
ENV_FILE="${APP_DIR}/.env"
PYTHON_BIN="${APP_DIR}/.venv/bin/python"

test -f "${ENV_FILE}"
test -x "${PYTHON_BIN}"

if grep -Eq '^DATA_ENCRYPTION_KEY=.+$' "${ENV_FILE}"; then
    exit 0
fi

KEY="$(${PYTHON_BIN} -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode("ascii"))')"

if grep -q '^DATA_ENCRYPTION_KEY=' "${ENV_FILE}"; then
    sed -i "s|^DATA_ENCRYPTION_KEY=.*$|DATA_ENCRYPTION_KEY=${KEY}|" "${ENV_FILE}"
else
    printf '\nDATA_ENCRYPTION_KEY=%s\n' "${KEY}" >> "${ENV_FILE}"
fi

chmod 0600 "${ENV_FILE}"
