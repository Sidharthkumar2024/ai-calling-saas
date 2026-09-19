#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/callvani
LOCK_FILE=/run/lock/callvani-update.lock

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$APP_DIR"
git fetch --quiet origin main

CURRENT_COMMIT="$(git rev-parse HEAD)"
TARGET_COMMIT="$(git rev-parse origin/main)"

if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]]; then
  exit 0
fi

git merge-base --is-ancestor "$CURRENT_COMMIT" "$TARGET_COMMIT"
git merge --ff-only "$TARGET_COMMIT"

npm ci
npm run build
npm --prefix services/media-gateway ci

systemctl restart callvani-app.service callvani-media.service

