#!/usr/bin/env bash
# test-mcp.sh — smoke-test the OpenOrmus MCP server
# Usage: ./scripts/test-mcp.sh [BASE_URL]
# Default BASE_URL: http://localhost:3001

set -euo pipefail

BASE="${1:-http://localhost:3001}"
MCP="$BASE/mcp"
PASS=0
FAIL=0

# ── helpers ────────────────────────────────────────────────────────────────────

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

ok() {
  green "  ✓ $1"
  PASS=$((PASS + 1))
}

fail() {
  red "  ✗ $1"
  FAIL=$((FAIL + 1))
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    ok "$label"
  else
    fail "$label (expected: $needle)"
    echo "    response: $haystack" >&2
  fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    fail "$label (unexpected: $needle)"
    echo "    response: $haystack" >&2
  else
    ok "$label"
  fi
}

assert_status() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    ok "$label (HTTP $got)"
  else
    fail "$label (expected HTTP $want, got $got)"
  fi
}

# Extract the inner JSON string from an MCP tool-call SSE response.
# SSE body: "data: {...,"result":{"content":[{"type":"text","text":"<escaped-json>"}]},...}"
# Returns the unescaped inner JSON (e.g. {"id":"...","name":"Zara",...}).
decode_tool_text() {
  python3 - <<'PY' "$1"
import sys, json
raw = sys.argv[1]
for line in raw.splitlines():
    line = line.strip()
    if not line.startswith("data:"):
        continue
    try:
        d = json.loads(line[5:].strip())
        content = d.get("result", {}).get("content", [])
        for item in content:
            if item.get("type") == "text":
                print(item["text"])
                sys.exit(0)
    except Exception:
        continue
PY
}

mcp_post() {
  # mcp_post <session_id_or_empty> <json_body>
  local sid="$1" body="$2"
  if [ -n "$sid" ]; then
    curl -s -w "\n__STATUS__%{http_code}" -X POST "$MCP" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "mcp-session-id: $sid" \
      -d "$body"
  else
    curl -s -w "\n__STATUS__%{http_code}" -X POST "$MCP" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d "$body"
  fi
}

split_response() {
  # Splits curl output into RESP_BODY / RESP_STATUS
  local raw="$1"
  RESP_BODY="${raw%__STATUS__*}"
  RESP_STATUS="${raw##*__STATUS__}"
}

# ── health ─────────────────────────────────────────────────────────────────────

bold "── health ──────────────────────────────────────────"
raw=$(curl -s -w "\n__STATUS__%{http_code}" "$BASE/health")
split_response "$raw"
assert_status "GET /health" "$RESP_STATUS" "200"
assert_contains "health body" "$RESP_BODY" '"status":"ok"'

# ── initialize session ─────────────────────────────────────────────────────────

bold "── initialize ──────────────────────────────────────"
INIT_BODY='{
  "jsonrpc":"2.0","id":1,"method":"initialize",
  "params":{
    "protocolVersion":"2024-11-05",
    "capabilities":{},
    "clientInfo":{"name":"test-script","version":"0.0.1"}
  }
}'

HEADER_FILE=$(mktemp)
raw=$(curl -s -w "\n__STATUS__%{http_code}" -D "$HEADER_FILE" -X POST "$MCP" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "$INIT_BODY")
split_response "$raw"
assert_status "POST /mcp initialize" "$RESP_STATUS" "200"
assert_contains "initialize result" "$RESP_BODY" '"protocolVersion"'
assert_contains "server name" "$RESP_BODY" '"name":"open-ormus"'

# Session ID is in the mcp-session-id response header
SESSION_ID=$(grep -i "^mcp-session-id:" "$HEADER_FILE" | tr -d '\r\n' | awk '{print $2}' || true)
rm -f "$HEADER_FILE"

if [ -n "$SESSION_ID" ]; then
  ok "session ID extracted: $SESSION_ID"
else
  fail "session ID not found — subsequent tests will use no session header"
  SESSION_ID=""
fi

# Send initialized notification (202 Accepted, no body)
NOTIF_BODY='{"jsonrpc":"2.0","method":"notifications/initialized"}'
raw=$(mcp_post "$SESSION_ID" "$NOTIF_BODY")
split_response "$raw"
if [ "$RESP_STATUS" = "200" ] || [ "$RESP_STATUS" = "202" ]; then
  ok "notifications/initialized (HTTP $RESP_STATUS)"
else
  fail "notifications/initialized (expected 200/202, got $RESP_STATUS)"
fi

# ── tools/list ─────────────────────────────────────────────────────────────────

bold "── tools/list ──────────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
split_response "$raw"
assert_status "tools/list" "$RESP_STATUS" "200"
assert_contains "character_create tool" "$RESP_BODY" "mcp__openormus__character_create"
assert_contains "character_get tool"    "$RESP_BODY" "mcp__openormus__character_get"
assert_contains "scene_simulate tool"   "$RESP_BODY" "mcp__openormus__scene_simulate"

# ── character_create ───────────────────────────────────────────────────────────

bold "── character_create ────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__character_create",
    "arguments":{"name":"Zara","description":"A spy","traits":["cunning","brave"]}
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_create" "$RESP_STATUS" "200"
assert_contains "name in result"    "$TEXT" '"name":"Zara"'
assert_contains "traits in result"  "$TEXT" '"cunning"'
assert_contains "id present"        "$TEXT" '"id"'
assert_contains "createdAt present" "$TEXT" '"createdAt"'

# Extract Zara's ID from the decoded inner JSON
ZARA_ID=$(echo "$TEXT" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4 || true)
if [ -n "$ZARA_ID" ]; then
  ok "Zara ID: $ZARA_ID"
else
  fail "could not extract Zara ID"
  ZARA_ID="unknown"
fi

# ── character_get — existing fixture ───────────────────────────────────────────

bold "── character_get (fixture) ─────────────────────────"
FIXTURE_ID="00000000-0000-0000-0000-000000000001"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__character_get\",
    \"arguments\":{\"id\":\"$FIXTURE_ID\"}
  }
}")
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_get fixture" "$RESP_STATUS" "200"
assert_contains "fixture character found" "$TEXT" '"id"'
assert_not_contains "fixture no error" "$TEXT" '"error"'

# ── character_get — created character ──────────────────────────────────────────

bold "── character_get (created) ─────────────────────────"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__character_get\",
    \"arguments\":{\"id\":\"$ZARA_ID\"}
  }
}")
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_get created" "$RESP_STATUS" "200"
assert_contains "Zara retrieved" "$TEXT" '"name":"Zara"'

# ── character_get — not found ──────────────────────────────────────────────────

bold "── character_get (not found) ───────────────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":6,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__character_get",
    "arguments":{"id":"00000000-dead-beef-0000-000000000000"}
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_get not_found" "$RESP_STATUS" "200"
assert_contains "not_found error" "$TEXT" '"error":"not_found"'

# ── scene_simulate — valid ─────────────────────────────────────────────────────

bold "── scene_simulate (valid) ──────────────────────────"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__scene_simulate\",
    \"arguments\":{
      \"characterIds\":[\"$FIXTURE_ID\",\"$ZARA_ID\"],
      \"setting\":\"A dark tavern\",
      \"prompt\":\"They meet for the first time.\"
    }
  }
}")
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "scene_simulate valid" "$RESP_STATUS" "200"
assert_contains "sceneId present"   "$TEXT" '"sceneId"'
assert_contains "dialogue present"  "$TEXT" '"dialogue"'
assert_contains "setting present"   "$TEXT" '"setting":"A dark tavern"'

# ── scene_simulate — unknown character ────────────────────────────────────────

bold "── scene_simulate (unknown character) ──────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":8,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__scene_simulate",
    "arguments":{
      "characterIds":["00000000-dead-beef-0000-000000000000"],
      "setting":"Void",
      "prompt":"Nobody here."
    }
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "scene_simulate unknown char" "$RESP_STATUS" "200"
assert_contains "character_not_found error" "$TEXT" '"error":"character_not_found"'

# ── summary ────────────────────────────────────────────────────────────────────

bold "────────────────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  green "All $TOTAL assertions passed."
else
  red "$FAIL/$TOTAL assertions failed."
  exit 1
fi
