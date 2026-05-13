#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/frontend/.env.local"
[ -f "$ENV_FILE" ] || { echo "Error: $ENV_FILE not found — copy .env.example to frontend/.env.local first"; exit 1; }
parse() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d '"' | tr -d "'"; }
export LITELLM_MODEL=$(parse LITELLM_MODEL)
export LITELLM_API_KEY=$(parse LITELLM_API_KEY)
[ -n "$LITELLM_MODEL" ] || { echo "Error: LITELLM_MODEL not set in $ENV_FILE"; exit 1; }
[ -n "$LITELLM_API_KEY" ] || { echo "Error: LITELLM_API_KEY not set in $ENV_FILE"; exit 1; }
exec litellm --config "$DIR/litellm_config.yaml"
