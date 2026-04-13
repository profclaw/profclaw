#!/bin/bash
# =============================================================================
# Test: Web Search + Action (Agentic)
# =============================================================================
# Tests: web_search or web_fetch -> use result -> create_ticket
# Validates web search integrates with other tools.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Test: Web Search + Action"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Model: $PROFCLAW_MODEL"

# More explicit prompt: name the tools, give clear sequence
MESSAGE="Do these two things in order:
1. Use the web_search tool (or web_fetch if web_search is not available) to search for 'TypeScript 5.7 new features'
2. After getting results, use create_ticket to create a ticket titled 'Evaluate TypeScript 5.7' with type 'feature' and include a brief description from the search results.

You MUST call both tools. Do not skip step 2."

log_info "Prompt: web search + create ticket"
echo ""

agentic_request "$CONV_ID" "$MESSAGE" 12 | while read -r line; do
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
          echo -e "${GREEN}[Tool]${NC} $tool_name  ${tool_args:0:100}"
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

          # Accept either web_search or web_fetch
          echo "$tool_names" | grep -qE "web_search|web_fetch" && log_success "web search tool called" || log_warn "Missing: web_search or web_fetch"
          # Check chaining to create_ticket
          echo "$tool_names" | grep -q "create_ticket" && log_success "create_ticket chained" || log_warn "Missing: create_ticket (model did not chain)"
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message')"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
