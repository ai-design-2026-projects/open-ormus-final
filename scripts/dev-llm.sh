#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/litellm.env.local"
[ -f "$ENV_FILE" ] || { echo "Error: $ENV_FILE not found — copy litellm.env.example to litellm.env.local first"; exit 1; }
set -a; source "$ENV_FILE"; set +a
[ -n "${LITELLM_MODEL:-}" ]   || { echo "Error: LITELLM_MODEL not set in $ENV_FILE"; exit 1; }
[ -n "${LITELLM_API_KEY:-}" ] || { echo "Error: LITELLM_API_KEY not set in $ENV_FILE"; exit 1; }
exec litellm --config "$DIR/litellm_config.yaml"
