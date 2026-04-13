#!/bin/bash
# =============================================================================
# Test: Error Recovery (Agentic)
# =============================================================================
# Tests that the agent recovers gracefully when a tool fails.
# Deliberately asks for something that will partially fail.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Test: Error Recovery"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Model: $PROFCLAW_MODEL"

MESSAGE="Try to read the file /tmp/nonexistent-file-12345.txt. If that fails, instead read the file src/server.ts and tell me the first 5 lines."

log_info "Prompt: deliberate failure + recovery"
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
          if [ "$status" = "executed" ]; then
            echo -e "${GREEN}[OK]${NC} $tool_name"
          elif [ "$status" = "failed" ]; then
            echo -e "${RED}[FAIL]${NC} $tool_name (expected - testing recovery)"
          else
            echo -e "${YELLOW}[???]${NC} $tool_name ($status)"
          fi
          ;;
        "summary")
          echo ""
          echo "--- SUMMARY ---"
          echo "$json" | jq -r '.data.summary'
          ;;
        "complete")
          echo ""
          tool_names=$(echo "$json" | jq -r '.data.toolCalls // [] | .[].name' 2>/dev/null)
          tool_count=$(echo "$json" | jq -r '.data.toolCalls // [] | length')
          log_success "Tools used: $tool_count total"
          echo "$tool_names" | nl

          # Should have called read_file at least twice (once fail, once succeed)
          rf_count=$(echo "$tool_names" | grep -c "read_file" || true)
          if [ "$rf_count" -ge 2 ]; then
            log_success "Recovery detected: read_file called $rf_count times (fail then retry)"
          elif [ "$rf_count" -eq 1 ]; then
            log_warn "Only 1 read_file call - may not have attempted the bad path first"
          else
            log_error "No read_file calls at all"
          fi
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message')"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
