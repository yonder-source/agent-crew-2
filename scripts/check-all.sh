#!/bin/sh
set -eu

COMPOSE_PROJECT_NAME=agent-crew-wbs2-check
COMPOSE_FILE=infra/local-dev/openclaw/compose.yaml
export COMPOSE_PROJECT_NAME
export COMPOSE_FILE

deployment_model=$(mktemp)
cleanup() { docker compose down --volumes; rm -f "$deployment_model"; }
trap cleanup EXIT INT TERM

docker compose --profile check config --format json > "$deployment_model"
node scripts/check-deployment.mjs "$deployment_model"
docker compose --profile check build
docker compose --profile check run --rm checks
docker compose up -d --force-recreate --wait --wait-timeout 300 gateway

attempt=0
until docker compose exec -T gateway openclaw gateway health --port 18789 --token disposable-agent-crew-token >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker compose logs gateway
    exit 1
  fi
  sleep 1
done

docker compose exec -T gateway sh -lc 'node scripts/check-gateway.mjs && node scripts/session-roundtrip.mjs'
docker compose restart gateway
docker compose up -d --wait --wait-timeout 300 gateway
attempt=0
until docker compose exec -T gateway openclaw gateway health --port 18789 --token disposable-agent-crew-token >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker compose logs gateway
    exit 1
  fi
  sleep 1
done
docker compose exec -T gateway node scripts/session-roundtrip.mjs --verify-only

node scripts/check-dispatcher.mjs
