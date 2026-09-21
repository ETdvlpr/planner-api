#!/usr/bin/env bash
#
# Turns the port-80 vhost into a redirect, once the Cloudflare zone is on
# Full (strict).
#
# Until then port 80 must serve the API: in Flexible mode Cloudflare reaches
# this origin over HTTP, and a redirect would loop. Run this after switching
# the zone, so plaintext stops being an option for anyone hitting the origin IP
# directly.
set -euo pipefail

VHOST=/etc/nginx/sites-available/memory-api.dave.com.et.conf
BACKUP="${VHOST}.$(date -u +%Y%m%dT%H%M%SZ).bak"

echo "Confirm the Cloudflare zone for dave.com.et is on Full (strict) before"
echo "running this, or the API becomes unreachable through Cloudflare."
read -r -p "Is it? [y/N] " reply
[ "$reply" = "y" ] || { echo "Aborted."; exit 1; }

cp "$VHOST" "$BACKUP"
python3 - "$VHOST" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path).read()
start = src.index('server {\n    listen 80;')
end = src.index('server {\n    listen 443')
redirect = '''server {
    listen 80;
    listen [::]:80;
    server_name memory-api.dave.com.et;
    return 301 https://$host$request_uri;
}

'''
open(path, 'w').write(src[:start] + redirect + src[end:])
PY

nginx -t && systemctl reload nginx
echo "Port 80 now redirects. Backup at $BACKUP"
