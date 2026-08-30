#!/usr/bin/env bash
# Issue the Let's Encrypt cert for app.zelyq.com and switch nginx to HTTPS.
# Run this only AFTER app.zelyq.com has an A record pointing at this VM
# (136.112.104.233) and `curl http://app.zelyq.com/api/health` works.
set -euo pipefail

DOMAIN=app.zelyq.com
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Checking $DOMAIN resolves to this host over IPv4"
resolved=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}') || true
echo "    $DOMAIN -> ${resolved:-<none>}"
if [ "${resolved:-}" != "136.112.104.233" ]; then
  echo "    WARNING: expected 136.112.104.233. Add the A record first, then re-run." >&2
  exit 1
fi

echo "==> Requesting certificate (webroot: /var/www/certbot)"
sudo certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --cert-name "$DOMAIN"

echo "==> Installing the full HTTPS vhost"
sudo cp "$REPO_DIR/deploy/app.zelyq.com.conf" /etc/nginx/sites-zelyq/app.zelyq.com.conf
sudo nginx -t
sudo systemctl reload nginx
sleep 2   # let the new worker start accepting before we probe

echo "==> Verifying"
curl -s -o /dev/null -w "http  -> %{http_code} (expect 301)\n" "http://$DOMAIN/"
curl -s -o /dev/null -w "https -> %{http_code} (expect 200)\n" "https://$DOMAIN/"
curl -s "https://$DOMAIN/api/health" | head -c 100; echo

echo "==> Done. Cert auto-renews via the system certbot timer;"
echo "    /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh reloads nginx after renewal."
