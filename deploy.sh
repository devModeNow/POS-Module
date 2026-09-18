#!/bin/sh
# Sequential production deploy. Parallel Compose builds race BuildKit and
# produce: unexpected commit digest / failed precondition / npm ci SIGSEGV.
set -eu
cd "$(dirname "$0")"

ENV_FILE="${ENV_FILE:-.env.docker}"
export COMPOSE_PARALLEL_LIMIT=1

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.docker.example and fill in values first." >&2
  exit 1
fi

echo "==> Clearing BuildKit cache"
docker builder prune -af

echo "==> Building backend"
docker compose --env-file "$ENV_FILE" build --no-cache alingbeth-prod-backend

echo "==> Building frontend"
docker compose --env-file "$ENV_FILE" build --no-cache alingbeth-prod-frontend

echo "==> Starting containers"
docker compose --env-file "$ENV_FILE" up -d

echo "==> Done"
docker compose --env-file "$ENV_FILE" ps
