#!/usr/bin/env bash
# setup-nginx-vhost.sh — nginx vhost for mainstreetmint.click → MainStreet Shield app
# Run on the VPS as root. No git on box — this is a standalone script.
set -euo pipefail

DOMAIN="mainstreetmint.click"
APP_PORT="3000"
VNC_PORT="5901"
WEBSOCKIFY_PORT="6901"

echo "[setup-nginx-vhost] Installing nginx if missing..."
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq nginx
fi

echo "[setup-nginx-vhost] Creating vhost for $DOMAIN..."
cat > /etc/nginx/sites-available/mainstreet-shield <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # TLS certificates — owner to provision via certbot or existing certs
    ssl_certificate     /etc/ssl/certs/mainstreetmint.click.crt;
    ssl_certificate_key /etc/ssl/private/mainstreetmint.click.key;

    # Proxy to MainStreet Shield Next.js app
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }

    # noVNC VNC proxy for Shield VM GUI
    location /shield/vnc/ {
        proxy_pass http://127.0.0.1:${WEBSOCKIFY_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 300s;
    }
}

# VNC proxy (websockify) listens on localhost only
EOF

# Enable the site
if [ -f /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi
ln -sf /etc/nginx/sites-available/mainstreet-shield /etc/nginx/sites-enabled/mainstreet-shield

echo "[setup-nginx-vhost] Testing nginx config..."
nginx -t

echo "[setup-nginx-vhost] Reloading nginx..."
systemctl reload nginx || systemctl restart nginx

echo "[setup-nginx-vhost] Done. DNS for $DOMAIN must point to this VPS IP."
echo "[setup-nginx-vhost] Provision TLS: certbot --nginx -d $DOMAIN -d www.$DOMAIN"