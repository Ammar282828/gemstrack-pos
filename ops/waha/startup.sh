#!/bin/bash
# WAHA — the WhatsApp HTTP API the POS sends through (both houses, one line).
#
# The startup script of the `waha` VM in gemstrack-pos (us-central1-a, e2-micro,
# static IP `waha-ip`). It runs on every boot and is safe to re-run: it installs
# Docker, adds swap (the VM has 1 GB), reads the API key and the dashboard
# password from Secret Manager (`waha-api-key`, `waha-dashboard-password`, read
# with the VM's own service account) and (re)starts two containers:
#
#   waha   devlikeapro/waha:gows — the GOWS engine, no browser, light enough
#          for an e2-micro. Sessions persist in /srv/waha/sessions, so the
#          linked number survives restarts and image updates.
#   caddy  HTTPS in front of it, certificate from Let's Encrypt for the
#          hostname in the instance metadata `waha-host` (default
#          <ip-with-dashes>.sslip.io, which needs no DNS of our own).
#
# The API key is given to WAHA hashed (sha512:…); only the POS holds it plain.
# To update WAHA: `sudo google_metadata_script_runner startup` on the VM, or
# just reset the VM. Setup notes: ops/waha/README.md.
set -euo pipefail
exec > >(tee -a /var/log/waha-startup.log) 2>&1
echo "== waha startup $(date -Is)"

md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }

# Swap — GOWS is small, but image pulls and Caddy share 1 GB.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 1G /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  apt-get update -q
  apt-get install -y -q docker.io
fi
systemctl enable --now docker

PROJECT=$(md project/project-id)
TOKEN=$(md instance/service-accounts/default/token | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')
secret() {
  curl -sf -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys, json, base64; print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode().strip(), end="")'
}
KEY_HASH=$(secret waha-api-key | sha512sum | cut -d' ' -f1)
DASH_PW=$(secret waha-dashboard-password)
IP=$(md instance/network-interfaces/0/access-configs/0/external-ip)
HOST=$(md instance/attributes/waha-host || echo "${IP//./-}.sslip.io")
echo "host: $HOST"

mkdir -p /srv/waha/sessions /srv/waha/media /srv/caddy/data /srv/caddy/config
docker network inspect waha-net >/dev/null 2>&1 || docker network create waha-net

docker pull -q devlikeapro/waha:gows
docker rm -f waha >/dev/null 2>&1 || true
docker run -d --name waha --network waha-net --restart unless-stopped \
  --memory 700m \
  -v /srv/waha/sessions:/app/.sessions \
  -v /srv/waha/media:/app/.media \
  -e WHATSAPP_DEFAULT_ENGINE=GOWS \
  -e "WAHA_API_KEY=sha512:$KEY_HASH" \
  -e WAHA_DASHBOARD_ENABLED=true \
  -e WAHA_DASHBOARD_USERNAME=taheri \
  -e "WAHA_DASHBOARD_PASSWORD=$DASH_PW" \
  -e WHATSAPP_SWAGGER_ENABLED=false \
  -e WHATSAPP_RESTART_ALL_SESSIONS=True \
  -e WAHA_PRINT_QR=False \
  -e "WAHA_BASE_URL=https://$HOST" \
  -e WAHA_LOG_LEVEL=info \
  devlikeapro/waha:gows

cat > /srv/caddy/Caddyfile <<EOF
$HOST {
  encode gzip
  reverse_proxy waha:3000
}
EOF
docker pull -q caddy:2
docker rm -f caddy >/dev/null 2>&1 || true
docker run -d --name caddy --network waha-net --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v /srv/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v /srv/caddy/data:/data \
  -v /srv/caddy/config:/config \
  caddy:2

docker image prune -f >/dev/null
echo "== waha startup done $(date -Is)"
