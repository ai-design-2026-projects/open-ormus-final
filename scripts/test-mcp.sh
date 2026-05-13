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
assert_contains "character_save tool"   "$RESP_BODY" "mcp__openormus__character_save"
assert_contains "character_list tool"   "$RESP_BODY" "mcp__openormus__character_list"
assert_contains "character_update tool" "$RESP_BODY" "mcp__openormus__character_update"
assert_contains "character_delete tool" "$RESP_BODY" "mcp__openormus__character_delete"
assert_contains "scene_simulate tool"   "$RESP_BODY" "mcp__openormus__scene_simulate"
assert_contains "character_search tool" "$RESP_BODY" "mcp__openormus__character_search"
assert_contains "show_search tool"      "$RESP_BODY" "mcp__openormus__show_search"

# ── character_save ─────────────────────────────────────────────────────────────

bold "── character_save ──────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__character_save",
    "arguments":{
      "name":"Zara",
      "imageUrl":null,
      "shortDescription":"A cunning spy from the future",
      "firstAppearanceDate":"2024-01-01",
      "confidence":2,
      "personality":{
        "personalityTraits":["cunning","brave","resourceful"],
        "backstory":"Former intelligence operative turned freelance.",
        "relationships":{"Handler":"complex"},
        "speechPatterns":["clipped sentences","dry wit"],
        "values":["loyalty","truth"],
        "fears":["exposure","failure"],
        "goals":["complete the mission","protect her cover"],
        "notableQuotes":["Trust no one."],
        "abilities":["hand-to-hand combat","hacking"],
        "copingStyle":["deflects with humour"],
        "knowledgeScope":{"tradecraft":"expert","languages":"intermediate"}
      }
    }
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_save" "$RESP_STATUS" "200"
assert_contains "name in result"      "$TEXT" '"name":"Zara"'
assert_contains "id present"          "$TEXT" '"id"'
assert_contains "userId present"      "$TEXT" '"userId"'
assert_contains "createdAt present"   "$TEXT" '"createdAt"'
assert_not_contains "no error field"  "$TEXT" '"error"'

SAVED_ID=$(echo "$TEXT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)
if [ -n "$SAVED_ID" ]; then
  ok "saved character ID: $SAVED_ID"
else
  fail "could not extract saved character ID"
  SAVED_ID="00000000-0000-4000-8000-000000000000"
fi

# ── character_list ─────────────────────────────────────────────────────────────

bold "── character_list ──────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"mcp__openormus__character_list","arguments":{}}}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_list" "$RESP_STATUS" "200"
assert_contains "list contains id" "$TEXT" '"id"'
assert_contains "list contains Zara" "$TEXT" '"name":"Zara"'

# ── character_update ───────────────────────────────────────────────────────────

bold "── character_update ────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__character_update\",
    \"arguments\":{
      \"id\":\"$SAVED_ID\",
      \"sheet\":{
        \"name\":\"Zara Updated\",
        \"imageUrl\":null,
        \"shortDescription\":\"Updated description\",
        \"firstAppearanceDate\":\"2024-06-01\",
        \"confidence\":3,
        \"personality\":{
          \"personalityTraits\":[\"cautious\"],
          \"backstory\":\"Her past was rewritten.\",
          \"relationships\":{},
          \"speechPatterns\":[],
          \"values\":[\"survival\"],
          \"fears\":[],
          \"goals\":[\"disappear\"],
          \"notableQuotes\":[],
          \"abilities\":[\"disguise\"],
          \"copingStyle\":[],
          \"knowledgeScope\":{}
        }
      }
    }
  }
}")
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_update" "$RESP_STATUS" "200"
assert_contains "updated name" "$TEXT" '"name":"Zara Updated"'
assert_not_contains "no error" "$TEXT" '"error"'

# ── character_update — not found ───────────────────────────────────────────────

bold "── character_update (not found) ────────────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":6,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__character_update",
    "arguments":{
      "id":"00000000-dead-beef-0000-000000000000",
      "sheet":{
        "name":"Ghost",
        "imageUrl":null,
        "shortDescription":"Does not exist",
        "firstAppearanceDate":"2000-01-01",
        "confidence":0,
        "personality":{
          "personalityTraits":[],
          "backstory":"",
          "relationships":{},
          "speechPatterns":[],
          "values":[],
          "fears":[],
          "goals":[],
          "notableQuotes":[],
          "abilities":[],
          "copingStyle":[],
          "knowledgeScope":{}
        }
      }
    }
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_update not_found" "$RESP_STATUS" "200"
assert_contains "not_found error" "$TEXT" '"error":"not_found"'

# ── scene_simulate — valid (uses saved character) ──────────────────────────────

bold "── scene_simulate (valid) ──────────────────────────"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__scene_simulate\",
    \"arguments\":{
      \"characterIds\":[\"$SAVED_ID\"],
      \"setting\":\"A dark tavern\",
      \"prompt\":\"She arrives alone.\"
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

# ── character_delete ───────────────────────────────────────────────────────────

bold "── character_delete ────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__character_delete\",
    \"arguments\":{\"id\":\"$SAVED_ID\"}
  }
}")
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_delete" "$RESP_STATUS" "200"
assert_contains "success true" "$TEXT" '"success":true'
assert_not_contains "no error" "$TEXT" '"error"'

# ── character_delete — not found ───────────────────────────────────────────────

bold "── character_delete (not found) ────────────────────"
raw=$(mcp_post "$SESSION_ID" "{
  \"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"mcp__openormus__character_delete\",
    \"arguments\":{\"id\":\"$SAVED_ID\"}
  }
}")
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_delete not_found" "$RESP_STATUS" "200"
assert_contains "not_found error" "$TEXT" '"error":"not_found"'

# ── character_search ───────────────────────────────────────────────────────────

bold "── character_search ────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":11,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__character_search",
    "arguments":{"query":"Berlin, Money Heist"}
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "character_search" "$RESP_STATUS" "200"
echo "    Raw response: $TEXT" >&2
# Accept either valid result or expected error (no Exa key, parse fail, etc)
if echo "$TEXT" | grep -qE '("name"|"error")'; then
  ok "character_search response valid (name or error field)"
  echo "    Parsed: $TEXT" >&2
else
  fail "character_search response invalid (no name or error field)"
  echo "    response: $TEXT" >&2
fi

# ── show_search ────────────────────────────────────────────────────────────────

bold "── show_search ─────────────────────────────────────"
raw=$(mcp_post "$SESSION_ID" '{
  "jsonrpc":"2.0","id":12,"method":"tools/call",
  "params":{
    "name":"mcp__openormus__show_search",
    "arguments":{"query":"Money Heist"}
  }
}')
split_response "$raw"
TEXT=$(decode_tool_text "$RESP_BODY")
assert_status "show_search" "$RESP_STATUS" "200"
echo "    Raw response: $TEXT" >&2
# Accept either valid result or expected error (no Exa key, parse fail, etc)
if echo "$TEXT" | grep -qE '("results"|"error")'; then
  ok "show_search response valid (results or error field)"
  echo "    Parsed: $TEXT" >&2
else
  fail "show_search response invalid (no results or error field)"
  echo "    response: $TEXT" >&2
fi

# ── summary ────────────────────────────────────────────────────────────────────

bold "────────────────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  green "All $TOTAL assertions passed."
else
  red "$FAIL/$TOTAL assertions failed."
  exit 1
fi
