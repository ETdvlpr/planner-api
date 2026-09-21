#!/usr/bin/env bash
#
# Deploys Planner API to memory-api.dave.com.et by pushing main and letting
# the server pull and build it.
#
# Nothing is uploaded: this machine pushes main to origin, and the server
# clones the branch into a fresh release directory, runs `npm ci`, generates
# the Prisma client, builds, applies migrations against its loopback-only
# Postgres, and only then swaps `current` over and restarts the service. A
# failed build, migration or smoke test leaves the running release untouched.
#
# Building on the server is the opposite of the old tarball strategy: `npm ci`
# and `nest build` are memory spikes the box shares with six other
# applications. Deploy outside peak hours. The flip side is that dependencies
# are installed for linux/x64 natively, so none of the cross-platform
# packaging machinery has to exist — and no 450 MB tarball crosses the wire.
#
# Migrations run on the server, so no SSH tunnel is needed; the Prisma CLI is
# present in the release tree until scripts/prune-runtime.sh removes it after
# the build.
#
# First-time provisioning (system user, database role, pg_hba confinement,
# .env, nginx snippets, TLS) is in deploy/provision.sh and is not repeated here.
set -euo pipefail

# The target host is deliberately not in this file: the repo is public and the
# origin sits behind Cloudflare, so its address is the one thing that must not
# be published. Put `HOST=user@<ip>` (and KEY_PATH if not the default) in
# `.deploy.env` next to this script — it is gitignored — or export them.
cd "$(dirname "$0")"
[ -f .deploy.env ] && . ./.deploy.env
: "${HOST:?set HOST=user@<vps-ip> (in .deploy.env or the environment)}"
KEY_PATH="${KEY_PATH:-$HOME/.ssh/id_ed25519}"
APP_DIR="${APP_DIR:-/var/www/planner-api}"
SERVICE="planner-api"
REPO="${REPO:-git@github.com:ETdvlpr/planner-api.git}"
BRANCH="${BRANCH:-main}"

SSH=(ssh -i "$KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new
     -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "$HOST")

# ── 1. Push main ────────────────────────────────────────────────────────────
# The server builds exactly what it pulls from origin, so anything uncommitted
# here would silently not ship. Refuse rather than deploy a tree that differs
# from the working copy.
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || {
  echo "ERROR: run deploy.sh from $BRANCH (currently on $(git rev-parse --abbrev-ref HEAD))"; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo "ERROR: uncommitted changes — commit or stash them, then re-run"; exit 1; }
echo "── Pushing $BRANCH ─────────────────────────────────────────────────"
git push origin "$BRANCH"
COMMIT="$(git rev-parse HEAD)"
echo "  $COMMIT"

# ── 2. Snapshot the other applications ──────────────────────────────────────
# This box carries three products with paying customers. Capture their state
# before touching anything, so "did this deploy break something?" is a diff
# rather than an opinion.
echo "── Pre-flight ──────────────────────────────────────────────────────"
BEFORE="$(mktemp)"
"${SSH[@]}" 'for s in hi-selam-api nginx postgresql@16-main mariadb php8.3-fpm supervisor pm2-root; do
  printf "%s=%s\n" "$s" "$(systemctl is-active $s 2>/dev/null)"; done' > "$BEFORE"
cat "$BEFORE" | sed 's/^/  /'

# ── 3. Pull, build, migrate, release ────────────────────────────────────────
"${SSH[@]}" "APP_DIR=$APP_DIR REPO=$REPO BRANCH=$BRANCH COMMIT=$COMMIT SERVICE=$SERVICE bash -s" <<'REMOTE'
set -euo pipefail
RELEASE="$APP_DIR/releases/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RELEASE"

echo "── Cloning $BRANCH ────────────────────────────────────────────────"
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$RELEASE"
ACTUAL="$(git -C "$RELEASE" rev-parse HEAD)"
if [ "$ACTUAL" != "$COMMIT" ]; then
  echo "ERROR: server pulled $ACTUAL but this deploy pushed $COMMIT"
  exit 1
fi
echo "  $ACTUAL"
ln -sfn "$APP_DIR/.env" "$RELEASE/.env"

echo "── Installing and building (the slow part) ────────────────────────"
(cd "$RELEASE" && npm ci --no-audit --no-fund && npx prisma generate && npm run build)

echo "── Migrating ───────────────────────────────────────────────────────"
DB_URL="$(grep '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2-)"
(cd "$RELEASE" && DATABASE_URL="$DB_URL" npx prisma migrate deploy)

echo "── Checking for schema drift ───────────────────────────────────────"
# Exit 0 means the deployed database matches prisma/schema.prisma; 2 means it
# does not, which after a successful `migrate deploy` means someone changed the
# database by hand.
if (cd "$RELEASE" && DATABASE_URL="$DB_URL" npx prisma migrate diff \
     --from-config-datasource --to-schema prisma/schema.prisma --exit-code) >/dev/null 2>&1; then
  echo "  database matches schema.prisma"
else
  echo "  ERROR: schema drift — the database does not match prisma/schema.prisma"
  exit 1
fi

echo "── Pruning to a runtime tree ───────────────────────────────────────"
# `npm prune` drops devDependencies (typescript, jest, the Nest CLI…) but can
# also remove node_modules/.prisma — the generated client the service cannot
# boot without. Save it across the prune.
TMP_PRISMA="$(mktemp -d)"
cp -R "$RELEASE/node_modules/.prisma" "$TMP_PRISMA/"
(cd "$RELEASE" && npm prune --omit=dev --no-audit --no-fund)
cp -R "$TMP_PRISMA/.prisma" "$RELEASE/node_modules/.prisma"
rm -rf "$TMP_PRISMA"
# …and strip the Prisma CLI, Studio and engines that @prisma/client drags in.
"$RELEASE/scripts/prune-runtime.sh" "$RELEASE/node_modules"

echo "── Smoke-testing the new build ─────────────────────────────────────"
# Boots the release against the production database on a throwaway port and
# checks health + auth before it is allowed to replace `current`.
(cd "$RELEASE" && SMOKE_DATABASE_URL="$DB_URL" ./scripts/smoke-dist.sh node_modules)

chown -R planner:planner "$RELEASE"

echo "── Releasing ───────────────────────────────────────────────────────"
PREVIOUS="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"

# Units and nginx config can change between releases; reinstall from the
# artefact, and only reload nginx if it still validates.
install -m 0644 "$RELEASE/deploy/systemd/planner-api.service"        /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/systemd/planner-recurrence.service" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/systemd/planner-recurrence.timer"   /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/systemd/planner-guest-sweep.service" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/systemd/planner-guest-sweep.timer"   /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/systemd/planner-backup.service"     /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/systemd/planner-backup.timer"       /etc/systemd/system/
install -m 0755 "$RELEASE/deploy/planner-backup.sh"                  /usr/local/bin/planner-backup.sh
sed -i "s#^WorkingDirectory=.*#WorkingDirectory=$APP_DIR/current#" \
  /etc/systemd/system/planner-api.service /etc/systemd/system/planner-recurrence.service \
  /etc/systemd/system/planner-guest-sweep.service
sed -i "s#^ReadWritePaths=.*#ReadWritePaths=$APP_DIR /var/backups/planner#" \
  /etc/systemd/system/planner-api.service /etc/systemd/system/planner-recurrence.service \
  /etc/systemd/system/planner-guest-sweep.service

install -m 0644 "$RELEASE/deploy/nginx/cloudflare-real-ip.conf" /etc/nginx/snippets/planner-cloudflare-real-ip.conf
install -m 0644 "$RELEASE/deploy/nginx/planner-proxy.conf"      /etc/nginx/snippets/planner-proxy.conf
install -m 0644 "$RELEASE/deploy/nginx/planner-log-format.conf" /etc/nginx/conf.d/planner-log-format.conf
install -m 0644 "$RELEASE/deploy/nginx/memory-api.dave.com.et.conf" \
  /etc/nginx/sites-available/memory-api.dave.com.et.conf
nginx -t >/dev/null 2>&1 && systemctl reload nginx || {
  echo "ERROR: nginx config invalid; nginx was NOT reloaded"; exit 1; }

ln -sfn "$RELEASE" "$APP_DIR/current"
systemctl daemon-reload
systemctl restart "$SERVICE"

for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3100/health >/dev/null 2>&1 && break
  if [ "$i" = 30 ]; then
    echo "ERROR: not healthy after 30s — rolling back"
    if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
      ln -sfn "$PREVIOUS" "$APP_DIR/current"
      systemctl restart "$SERVICE"
      echo "rolled back to $PREVIOUS"
    fi
    journalctl -u "$SERVICE" --no-pager -n 40
    exit 1
  fi
  sleep 1
done

curl -sS http://127.0.0.1:3100/health; echo
# Keep five releases; each carries its own node_modules and dist.
ls -dt "$APP_DIR"/releases/*/ | tail -n +6 | xargs -r rm -rf
REMOTE

# ── 4. Prove nothing else moved ─────────────────────────────────────────────
echo "── Post-flight ─────────────────────────────────────────────────────"
AFTER="$(mktemp)"
"${SSH[@]}" 'for s in hi-selam-api nginx postgresql@16-main mariadb php8.3-fpm supervisor pm2-root; do
  printf "%s=%s\n" "$s" "$(systemctl is-active $s 2>/dev/null)"; done' > "$AFTER"

if diff -q "$BEFORE" "$AFTER" >/dev/null; then
  echo "  all other services unchanged"
else
  echo "  WARNING: another service changed state:"
  diff "$BEFORE" "$AFTER" | sed 's/^/    /'
fi
rm -f "$BEFORE" "$AFTER"

echo "── Done: https://memory-api.dave.com.et ────────────────────────────"
