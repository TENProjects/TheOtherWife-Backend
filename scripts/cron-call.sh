#!/usr/bin/env bash
# Calls one internal cron endpoint with the CRON_SECRET from an env file.
#
#   cron-call.sh <env-file> <base-url> <endpoint-path>
#   e.g. cron-call.sh /opt/the-other-wife-backend/.env.prod http://127.0.0.1:8000 /api/v1/internal/cron/partner-webhooks/run
#
# The secret is read at run time (so rotating it in the env file needs no
# crontab change) and passed to curl on stdin, never as a command-line
# argument, so it doesn't show up in `ps` output. Prints nothing on success;
# errors go to stderr (and from there to the cron log).
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <env-file> <base-url> <endpoint-path>" >&2
  exit 2
fi

ENV_FILE="$1"
BASE_URL="${2%/}"
ENDPOINT="$3"

if [ ! -r "$ENV_FILE" ]; then
  echo "$(date -u +%FT%TZ) cannot read $ENV_FILE" >&2
  exit 1
fi

# `|| true`: with pipefail, a missing CRON_SECRET line would otherwise abort
# here silently instead of reaching the explicit error below.
secret="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true)"
secret="${secret%\"}"; secret="${secret#\"}"
secret="${secret%\'}"; secret="${secret#\'}"

if [ -z "$secret" ]; then
  echo "$(date -u +%FT%TZ) CRON_SECRET is empty or missing in $ENV_FILE" >&2
  exit 1
fi

if ! printf 'Authorization: Bearer %s\n' "$secret" \
  | curl -fsS --max-time 120 -o /dev/null -H @- "${BASE_URL}${ENDPOINT}"; then
  echo "$(date -u +%FT%TZ) cron call failed: ${ENDPOINT}" >&2
  exit 1
fi
