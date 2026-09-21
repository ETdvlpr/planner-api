#!/usr/bin/env bash
#
# One-time provisioning for a new Planner API host. Idempotent, but not part of
# the normal deploy — deploy.sh assumes this has already run.
#
# Everything here is scoped so that Planner cannot affect the other six
# applications sharing this box:
#
#   · a dedicated `planner` system user with no shell and no login
#   · a dedicated Postgres role and database, NOSUPERUSER NOCREATEDB
#   · a pg_hba rule confining that role to its own database (PostgreSQL grants
#     CONNECT on every database to PUBLIC and that grant cannot be revoked for
#     a single role, so the confinement has to be expressed in pg_hba)
#   · private nginx snippets rather than edits to the shared proxy_params
#   · a TLS certificate that is deliberately NOT certbot-managed
#
# Usage:  DB_PASS=... DOCS_PASS=... ./provision.sh
set -euo pipefail
export LC_ALL=C LANG=C

: "${DB_PASS:?set DB_PASS to the password for the planner database role}"
: "${DOCS_PASS:?set DOCS_PASS to the basic-auth password for /api/v1/docs}"
APP_DIR=/var/www/planner-api
HBA=/etc/postgresql/16/main/pg_hba.conf

echo "── system user ─────────────────────────────────────────────────────"
id -u planner >/dev/null 2>&1 \
  || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin planner

echo "── directories ─────────────────────────────────────────────────────"
mkdir -p "$APP_DIR/releases" /var/backups/planner /etc/ssl/planner /etc/nginx/snippets
chown -R planner:planner "$APP_DIR"
chmod 750 "$APP_DIR"
chmod 700 /etc/ssl/planner /var/backups/planner

echo "── database role and database ──────────────────────────────────────"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='planner'" | grep -q 1 \
  || sudo -u postgres psql -c \
     "CREATE ROLE planner LOGIN PASSWORD '${DB_PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='planner'" | grep -q 1 \
  || sudo -u postgres createdb -O planner planner
sudo -u postgres psql -c "REVOKE ALL ON DATABASE planner FROM PUBLIC" >/dev/null
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE planner TO planner" >/dev/null
sudo -u postgres psql -d planner -c "GRANT ALL ON SCHEMA public TO planner" >/dev/null

echo "── confining the role to its own database ──────────────────────────"
if grep -q "Planner API: confined" "$HBA"; then
  echo "  pg_hba rule already present"
else
  cp "$HBA" "${HBA}.$(date -u +%Y%m%dT%H%M%SZ).bak"
  python3 - "$HBA" <<'PY'
import sys
path = sys.argv[1]
lines = open(path).readlines()
rule = """# Planner API: confined to its own database. PostgreSQL grants CONNECT on every
# database to PUBLIC by default and that grant cannot be revoked for a single
# role, so the confinement is expressed here instead. Purely additive - no
# existing rule is modified, and only the 'planner' role is matched.
host    planner         planner         127.0.0.1/32            scram-sha-256
host    all             planner         all                     reject

"""
for i, line in enumerate(lines):
    if line.startswith('host    all             all             127.0.0.1/32'):
        lines.insert(i, rule)
        break
else:
    raise SystemExit('anchor line not found - refusing to guess')
open(path, 'w').write(''.join(lines))
PY
  # Reload, never restart: a restart drops every other application's pooled
  # connections at once.
  sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl reload -D /var/lib/postgresql/16/main
  echo "  rule added and Postgres reloaded"
fi

echo "── verifying the confinement ───────────────────────────────────────"
for db in planner hiselam_api infnova_db postgres; do
  if PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U planner -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    printf "  planner -> %-20s REACHABLE\n" "$db"
    [ "$db" = planner ] || { echo "  ERROR: planner can reach $db"; exit 1; }
  else
    printf "  planner -> %-20s blocked\n" "$db"
    [ "$db" = planner ] && { echo "  ERROR: planner cannot reach its own database"; exit 1; }
  fi
done

echo "── docs basic auth ─────────────────────────────────────────────────"
printf 'planner:%s\n' "$(openssl passwd -apr1 "$DOCS_PASS")" > /etc/nginx/.htpasswd-planner
chmod 640 /etc/nginx/.htpasswd-planner
chown root:www-data /etc/nginx/.htpasswd-planner

echo "── origin TLS ──────────────────────────────────────────────────────"
# Self-signed placeholder so the Cloudflare→origin hop is encrypted from the
# start. Replace with a Cloudflare Origin Certificate, then set the zone to
# Full (strict). Deliberately not certbot: that service is already in a failed
# state on this host across eight vhosts, and this API must not inherit that.
if [ ! -f /etc/ssl/planner/origin.pem ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/ssl/planner/origin.key -out /etc/ssl/planner/origin.pem \
    -subj "/CN=memory-api.dave.com.et/O=Planner origin (self-signed placeholder)" \
    -addext "subjectAltName=DNS:memory-api.dave.com.et" 2>/dev/null
  chmod 600 /etc/ssl/planner/origin.key
  chmod 644 /etc/ssl/planner/origin.pem
  echo "  placeholder certificate generated"
else
  echo "  certificate already present"
fi

echo
echo "Provisioned. Write $APP_DIR/.env (see .env.example), then run deploy.sh."
