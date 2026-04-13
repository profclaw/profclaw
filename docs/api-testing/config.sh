#!/bin/bash
# =============================================================================
# profClaw API Testing Configuration
# =============================================================================
# Source this file in your test scripts: source ./config.sh
#
# This file stores common settings and provides helper functions for API testing.
# Run setup.sh first to create a test conversation and store the ID.

# Base configuration
export PROFCLAW_BASE_URL="${PROFCLAW_BASE_URL:-http://localhost:3000}"
export PROFCLAW_API_URL="${PROFCLAW_BASE_URL}/api"
export PROFCLAW_MODEL="${PROFCLAW_MODEL:-gpt4o-mini}"  # Default to Azure GPT-4o Mini

# Timeouts (seconds)
export CURL_TIMEOUT="${CURL_TIMEOUT:-30}"         # Simple API requests
export AGENTIC_TIMEOUT="${AGENTIC_TIMEOUT:-90}"   # Agentic SSE streaming
export TEST_TIMEOUT="${TEST_TIMEOUT:-120}"         # Per-test timeout in run-all.sh

# State file (stores conversation IDs, etc.)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROFCLAW_STATE_FILE="${SCRIPT_DIR}/.test-state.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m' # No Color

# =============================================================================
# Helper Functions
# =============================================================================

# Print colored output
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_time() { echo -e "${DIM}[TIME]${NC} $1"; }

# Initialize state file if it doesn't exist
init_state() {
  if [ ! -f "$PROFCLAW_STATE_FILE" ]; then
    echo '{}' > "$PROFCLAW_STATE_FILE"
    log_info "Created state file: $PROFCLAW_STATE_FILE"
  fi
}

# Get value from state file
get_state() {
  local key="$1"
  init_state
  jq -r ".$key // empty" "$PROFCLAW_STATE_FILE"
}

# Set value in state file
set_state() {
  local key="$1"
  local value="$2"
  init_state
  local tmp=$(mktemp)
  jq ".$key = \"$value\"" "$PROFCLAW_STATE_FILE" > "$tmp" && mv "$tmp" "$PROFCLAW_STATE_FILE"
}

# Get or create default conversation
get_conversation_id() {
  local conv_id=$(get_state "conversationId")
  if [ -z "$conv_id" ]; then
    log_warn "No conversation ID found. Run setup.sh first."
    return 1
  fi
  echo "$conv_id"
}

# Create an isolated conversation for a single test (prevents state pollution)
create_test_conversation() {
  local title="${1:-API Test}"
  local response
  response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "${PROFCLAW_API_URL}/chat/conversations" \
    -H "Content-Type: application/json" \
    -d "{\"title\": \"$title\", \"presetId\": \"profclaw-assistant\"}")
  local conv_id
  conv_id=$(echo "$response" | jq -r '.conversation.id // empty')
  if [ -z "$conv_id" ]; then
    log_error "Failed to create test conversation"
    return 1
  fi
  echo "$conv_id"
}

# Pretty print JSON response
pretty_json() {
  if command -v jq &> /dev/null; then
    jq '.'
  else
    cat
  fi
}

# Make API request with common headers and timeout
api_request() {
  local method="$1"
  local endpoint="$2"
  local data="$3"

  local url="${PROFCLAW_API_URL}${endpoint}"

  if [ -n "$data" ]; then
    curl -s --max-time "$CURL_TIMEOUT" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s --max-time "$CURL_TIMEOUT" -X "$method" "$url" \
      -H "Content-Type: application/json"
  fi
}

# Make agentic SSE request with timeout
agentic_request() {
  local conv_id="$1"
  local message="$2"
  local max_steps="${3:-10}"

  curl -s -N --max-time "$AGENTIC_TIMEOUT" \
    -X POST "${PROFCLAW_API_URL}/chat/conversations/$conv_id/messages/agentic" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d "{
      \"content\": $(echo "$message" | jq -Rs .),
      \"showThinking\": false,
      \"maxSteps\": $max_steps,
      \"model\": \"$PROFCLAW_MODEL\"
    }"
}

# Check if server is running
check_server() {
  if ! curl -s --max-time 5 "${PROFCLAW_BASE_URL}/health" > /dev/null 2>&1; then
    log_error "Server not running at ${PROFCLAW_BASE_URL}"
    log_info "Start the server with: pnpm dev"
    return 1
  fi
  log_success "Server is running at ${PROFCLAW_BASE_URL}"
  return 0
}

# =============================================================================
# Timing Helpers
# =============================================================================

# Get current time in milliseconds (macOS compatible)
now_ms() {
  if command -v gdate &> /dev/null; then
    gdate +%s%3N
  elif [[ "$(uname)" == "Darwin" ]]; then
    python3 -c 'import time; print(int(time.time() * 1000))'
  else
    date +%s%3N
  fi
}

# Format milliseconds to human-readable
format_duration() {
  local ms="$1"
  if [ "$ms" -lt 1000 ]; then
    echo "${ms}ms"
  elif [ "$ms" -lt 60000 ]; then
    echo "$(( ms / 1000 )).$(( (ms % 1000) / 100 ))s"
  else
    echo "$(( ms / 60000 ))m $(( (ms % 60000) / 1000 ))s"
  fi
}

# =============================================================================
# SSE Stream Parser (reusable across agentic tests)
# =============================================================================
# Usage: agentic_request "$CONV_ID" "$MESSAGE" 10 | parse_sse_stream
# Captures tool names in $PROFCLAW_TOOLS_FILE (temp file)

export PROFCLAW_TOOLS_FILE=""

parse_sse_stream() {
  PROFCLAW_TOOLS_FILE=$(mktemp)
  while read -r line; do
    if [[ "$line" == data:* ]]; then
      json="${line#data: }"
      [ -z "$json" ] && continue
      event_type=$(echo "$json" | jq -r '.type // "unknown"' 2>/dev/null)

      case "$event_type" in
        "step:start")
          echo -e "${BLUE}[Step $(echo "$json" | jq -r '.data.step')]${NC}"
          ;;
        "tool:call")
          tool_name=$(echo "$json" | jq -r '.data.name')
          echo -e "${GREEN}[Tool]${NC} $tool_name"
          ;;
        "tool:result")
          tool_name=$(echo "$json" | jq -r '.data.name')
          status=$(echo "$json" | jq -r '.data.status // "?"')
          [ "$status" = "executed" ] && echo -e "${GREEN}[OK]${NC} $tool_name" || echo -e "${RED}[FAIL]${NC} $tool_name ($status)"
          ;;
        "summary")
          echo ""
          echo "--- SUMMARY ---"
          echo "$json" | jq -r '.data.summary'
          ;;
        "complete")
          echo ""
          tool_names=$(echo "$json" | jq -r '.data.toolCalls // [] | .[].name' 2>/dev/null)
          echo "$tool_names" > "$PROFCLAW_TOOLS_FILE"
          log_success "Tools: $(echo "$tool_names" | tr '\n' ', ')"
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message')"
          ;;
      esac
    fi
  done
}

# Check if expected tools were called (reads from PROFCLAW_TOOLS_FILE)
check_expected_tools() {
  local tools_file="$1"
  shift
  local all_found=true
  for expected in "$@"; do
    if grep -q "$expected" "$tools_file" 2>/dev/null; then
      log_success "Expected: $expected"
    else
      log_warn "Missing: $expected"
      all_found=false
    fi
  done
  $all_found
}

# =============================================================================
# Exports for test scripts
# =============================================================================
export -f log_info log_success log_warn log_error log_time
export -f init_state get_state set_state get_conversation_id create_test_conversation
export -f pretty_json api_request agentic_request check_server
export -f now_ms format_duration
export -f parse_sse_stream check_expected_tools
