#!/bin/bash
# =============================================================================
# Test: File Operations Chain (Agentic)
# =============================================================================
# Tests: read_file -> search_files -> grep -> summarize
# Validates file tools work in sequence for code exploration.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Test: File Operations Chain"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Model: $PROFCLAW_MODEL"

MESSAGE="Search for all TypeScript files in src/routes/, then read the main index.ts routes file, and grep for 'chatRoutes' across the codebase. Give me a summary of the routing structure."

log_info "Prompt: search -> read -> grep chain"
echo ""

agentic_request "$CONV_ID" "$MESSAGE" 10 | while read -r line; do
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
          tool_args=$(echo "$json" | jq -c '.data.arguments // {}')
          echo -e "${GREEN}[Tool]${NC} $tool_name  ${tool_args:0:80}"
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
          log_success "Tools: $(echo "$tool_names" | tr '\n' ', ')"

          for expected in search_files read_file grep; do
            echo "$tool_names" | grep -q "$expected" && log_success "$expected" || log_warn "Missing: $expected"
          done
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message')"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
