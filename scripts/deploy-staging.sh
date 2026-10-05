#!/usr/bin/env bash
# Staging counterpart of deploy.sh. Runs from the staging checkout
# (e.g. /opt/the-other-wife-backend-staging), uses .env.staging and its own
# compose project so it never touches the production container.
set -euo pipefail

COMPOSE=(docker compose -f docker-compose.staging.yml -p tow-staging)

if [ ! -f .env.staging ]; then
  echo "Error: .env.staging not found. Copy .env.example to .env.staging and fill in staging values first." >&2
  exit 1
fi

if grep -Eq '^MONGODB_URI=.*(/test(\?|$)|/\?|\.net/?$)' .env.staging; then
  echo "Error: .env.staging MONGODB_URI must name a dedicated staging database (e.g. .../tow_staging?...)," >&2
  echo "       not the cluster default database, which holds production data." >&2
  exit 1
fi

echo "==> Pulling latest code"
git pull

echo "==> Building staging image"
"${COMPOSE[@]}" build

echo "==> Starting staging container"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> Waiting for staging to respond..."
for _ in $(seq 1 15); do
  if curl -fsS -o /dev/null "http://127.0.0.1:8001/"; then
    echo "==> Staging deploy succeeded - app is responding on 127.0.0.1:8001."
    docker image prune -f
    exit 0
  fi
  sleep 2
done

echo "Error: staging did not respond within 30s. Check logs:" >&2
echo "  ${COMPOSE[*]} logs --tail=100 api" >&2
exit 1
