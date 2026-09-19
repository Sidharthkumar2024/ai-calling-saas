#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/callvani
LOCK_FILE=/run/lock/callvani-update.lock

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$APP_DIR"
git -c safe.directory="$APP_DIR" fetch --quiet origin main

CURRENT_COMMIT="$(git -c safe.directory="$APP_DIR" rev-parse HEAD)"
TARGET_COMMIT="$(git -c safe.directory="$APP_DIR" rev-parse origin/main)"

if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]]; then
  exit 0
fi

git -c safe.directory="$APP_DIR" merge-base --is-ancestor "$CURRENT_COMMIT" "$TARGET_COMMIT"
git -c safe.directory="$APP_DIR" merge --ff-only "$TARGET_COMMIT"

npm ci
npm run build
npm --prefix services/media-gateway ci

chown -R callvani:callvani "$APP_DIR"

systemctl restart callvani-app.service callvani-media.service
