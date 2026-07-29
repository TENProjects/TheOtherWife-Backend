#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env.prod ]; then
  echo "Error: .env.prod not found. Copy .env.example to .env.prod and fill in real values first." >&2
  exit 1
fi

echo "==> Pulling latest code"
git pull

echo "==> Building image"
docker compose build

echo "==> Starting new container"
docker compose up -d --remove-orphans

echo "==> Waiting for the app to respond..."
for _ in $(seq 1 15); do
  if curl -fsS -o /dev/null "http://127.0.0.1:8000/"; then
    echo "==> Deploy succeeded - app is responding."
    docker image prune -f
    exit 0
  fi
  sleep 2
done

echo "Error: app did not respond within 30s after deploy. Check logs:" >&2
echo "  docker compose logs --tail=100 api" >&2
exit 1
