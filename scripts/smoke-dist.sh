#!/usr/bin/env bash
#
# Boots the built artefact against a real database and checks it serves.
#
# This is what makes pruning the runtime tree (scripts/prune-runtime.sh) a
# verified optimisation rather than a hopeful one: it runs `dist/main.js` with
# exactly the `node_modules` that will be shipped, and fails the build if the
# service cannot start or cannot reach Postgres.
#
# Needs SMOKE_DATABASE_URL pointing at a throwaway database.
set -euo pipefail

TREE="${1:?usage: smoke-dist.sh <node_modules path>}"
PORT="${SMOKE_PORT:-3197}"

if [ -z "${SMOKE_DATABASE_URL:-}" ]; then
  echo "WARNING: SMOKE_DATABASE_URL not set — shipping an unverified tree."
  echo "         Set it to a throwaway database to make this a real check."
  exit 0
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R dist "$STAGE/dist"
cp -R prisma "$STAGE/prisma"
cp package.json "$STAGE/"
cp -R "$TREE" "$STAGE/node_modules"

echo "Booting the packaged artefact on :${PORT}…"
(
  cd "$STAGE"
  NODE_ENV=production \
  ENABLE_SWAGGER=false \
  PORT="$PORT" \
  DATABASE_URL="$SMOKE_DATABASE_URL" \
  FIREBASE_PROJECT_ID=smoke-test \
  node dist/main.js > "$STAGE/boot.log" 2>&1 &
  echo $! > "$STAGE/pid"
)

PID="$(cat "$STAGE/pid")"

# Preserve the exit status across cleanup. Without the explicit `exit $rc` the
# trap's last command — `rm -rf`, which always succeeds — becomes the script's
# status, and a failed smoke test reports success to the caller.
cleanup() {
  rc=$?
  kill "$PID" 2>/dev/null || true
  rm -rf "$STAGE"
  exit "$rc"
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$i" = 30 ]; then
    echo "ERROR: packaged artefact did not become healthy."
    cat "$STAGE/boot.log"
    exit 1
  fi
  sleep 1
done

BODY="$(curl -fsS "http://127.0.0.1:$PORT/health")"
echo "  $BODY"

# `database":"up"` proves Prisma really executed a query through the driver
# adapter with the pruned tree — a boot alone would not.
if ! echo "$BODY" | grep -q '"database":"up"'; then
  echo "ERROR: the service booted but could not reach Postgres."
  cat "$STAGE/boot.log"
  exit 1
fi

# An authenticated route must still reject cleanly rather than crash, which
# proves firebase-admin loaded from the pruned tree.
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/tasks")"
if [ "$CODE" != "401" ]; then
  echo "ERROR: expected 401 from an unauthenticated route, got $CODE"
  cat "$STAGE/boot.log"
  exit 1
fi

echo "Packaged artefact verified: health ok, database up, auth enforced."
