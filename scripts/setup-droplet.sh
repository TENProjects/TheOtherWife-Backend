#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/the-other-wife-backend"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (sudo bash scripts/setup-droplet.sh)." >&2
  exit 1
fi

echo "==> Updating apt package index"
apt-get update -y

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "    docker already installed, skipping"
fi

DEPLOY_USER="${SUDO_USER:-$USER}"
if [ "$DEPLOY_USER" != "root" ] && ! id -nG "$DEPLOY_USER" | grep -qw docker; then
  echo "==> Adding $DEPLOY_USER to the docker group (log out/in for this to take effect)"
  usermod -aG docker "$DEPLOY_USER"
fi

echo "==> Installing nginx + certbot"
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Configuring firewall (ufw)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 'Nginx Full'
  ufw --force enable
else
  echo "    ufw not found, skipping firewall config - configure manually"
fi

if [ ! -f /swapfile ]; then
  echo "==> Creating a 2G swapfile"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "    /swapfile already exists, skipping"
fi

echo "==> Creating app directory: $APP_DIR"
mkdir -p "$APP_DIR"
[ "$DEPLOY_USER" != "root" ] && chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"

cat <<EOF

==> Done. Next steps:
    1. git clone <your-repo-url> $APP_DIR
    2. cd $APP_DIR && cp .env.example .env.prod, then fill in real values
    3. Install the nginx config (see deploy/nginx/the-other-wife-backend.conf)
    4. sudo certbot --nginx -d your.domain.com
    5. bash scripts/deploy.sh
EOF
