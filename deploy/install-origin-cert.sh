#!/usr/bin/env bash
#
# Installs a Cloudflare Origin Certificate, replacing the self-signed
# placeholder, so the zone can move to Full (strict).
#
# Generate the certificate at:
#   Cloudflare dashboard → dave.com.et → SSL/TLS → Origin Server
#   → Create Certificate → hostnames: memory-api.dave.com.et
#
# Then run:  ./install-origin-cert.sh origin.pem origin.key
set -euo pipefail

CERT_IN="${1:?usage: install-origin-cert.sh <cert.pem> <key.pem>}"
KEY_IN="${2:?usage: install-origin-cert.sh <cert.pem> <key.pem>}"

openssl x509 -in "$CERT_IN" -noout -subject -dates
openssl x509 -in "$CERT_IN" -noout -modulus | openssl md5 > /tmp/.c
openssl rsa  -in "$KEY_IN"  -noout -modulus | openssl md5 > /tmp/.k
cmp -s /tmp/.c /tmp/.k || { echo "ERROR: certificate and key do not match"; exit 1; }
rm -f /tmp/.c /tmp/.k

cp /etc/ssl/planner/origin.pem "/etc/ssl/planner/origin.pem.$(date -u +%Y%m%dT%H%M%SZ).bak" 2>/dev/null || true
install -m 0644 "$CERT_IN" /etc/ssl/planner/origin.pem
install -m 0600 "$KEY_IN"  /etc/ssl/planner/origin.key

nginx -t && systemctl reload nginx
echo "Installed. Now set the Cloudflare zone's SSL mode to Full (strict),"
echo "then optionally run deploy/harden-http.sh to stop serving plaintext on :80."
