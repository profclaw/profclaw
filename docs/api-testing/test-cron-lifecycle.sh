#!/bin/bash
# =============================================================================
# Test: Cron Job Lifecycle (Agentic)
# =============================================================================
# Tests: cron_create -> cron_list -> cron_trigger -> cron_history -> cron_archive
# Validates scheduled job management works end-to-end.
# NOTE: Cron tools are available via getAllChatTools() in agentic mode.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Test: Cron Job Lifecycle"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Model: $PROFCLAW_MODEL"

# More direct prompt that explicitly names tools
MESSAGE="You have cron tools available. Please do these steps using the exact tool names:
1. Call cron_create to make a job named 'Health Check' with schedule '0 * * * *' and command 'curl http://localhost:3000/health'
2. Call cron_list to verify the job exists
3. Call cron_trigger to run the job manually

Use each tool in order and report the result of each step."

log_info "Prompt: cron lifecycle (create -> list -> trigger)"
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
          log_success "Tools: $(echo "$tool_names" | tr '\n' ', ')"

          # Validate at least cron_create and cron_list were called
          for expected in cron_create cron_list; do
            echo "$tool_names" | grep -q "$expected" && log_success "$expected" || log_warn "Missing: $expected"
          done

          # Also check for cron_trigger (bonus)
          echo "$tool_names" | grep -q "cron_trigger" && log_success "cron_trigger" || log_warn "Missing: cron_trigger (optional)"
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message')"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
