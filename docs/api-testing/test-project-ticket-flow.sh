#!/bin/bash
# =============================================================================
# Test: Project + Ticket Multi-Step Flow (Agentic)
# =============================================================================
# Tests: create_project -> list_projects -> create_ticket -> update_ticket -> get_ticket
# Validates the full profClaw ops pipeline works end-to-end.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

PROJ_NAME="${1:-API Test Project}"

echo "========================================"
echo "Test: Project + Ticket Multi-Step Flow"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Model: $PROFCLAW_MODEL"

MESSAGE="Do these steps in order:
1. Create a project named '$PROJ_NAME' with key 'APITEST' and icon '🧪'
2. Create a ticket in that project titled 'Setup CI Pipeline' type 'task' priority 'high'
3. Update that ticket status to 'in_progress'
4. Get the ticket details to confirm the update

Report what happened at each step."

log_info "Prompt: multi-step project+ticket flow"
echo ""

log_info "Starting agentic session..."
echo ""

agentic_request "$CONV_ID" "$MESSAGE" 15 | while read -r line; do
    if [[ "$line" == data:* ]]; then
      json="${line#data: }"
      [ -z "$json" ] && continue

      event_type=$(echo "$json" | jq -r '.type // "unknown"' 2>/dev/null)

      case "$event_type" in
        "step:start")
          step=$(echo "$json" | jq -r '.data.step // "?"')
          echo -e "${BLUE}[Step $step]${NC} Starting..."
          ;;
        "tool:call")
          tool_name=$(echo "$json" | jq -r '.data.name // "unknown"')
          tool_args=$(echo "$json" | jq -c '.data.arguments // {}')
          echo -e "${GREEN}[Tool]${NC} $tool_name"
          echo "  Args: ${tool_args:0:120}"
          ;;
        "tool:result")
          tool_name=$(echo "$json" | jq -r '.data.name // "unknown"')
          status=$(echo "$json" | jq -r '.data.status // "unknown"')
          if [ "$status" = "executed" ]; then
            echo -e "${GREEN}[OK]${NC} $tool_name succeeded"
          elif [ "$status" = "failed" ]; then
            echo -e "${RED}[FAIL]${NC} $tool_name failed"
            echo "$json" | jq -r '.data.error // ""'
          else
            echo -e "${YELLOW}[???]${NC} $tool_name ($status)"
          fi
          ;;
        "summary")
          echo ""
          echo "========================================"
          echo "SUMMARY"
          echo "========================================"
          echo "$json" | jq -r '.data.summary // "No summary"'
          ;;
        "complete")
          echo ""
          total_steps=$(echo "$json" | jq -r '.data.totalSteps // "?"')
          total_tokens=$(echo "$json" | jq -r '.data.totalTokens // "?"')
          tool_calls=$(echo "$json" | jq -r '.data.toolCalls // [] | length')
          log_success "Complete: $total_steps steps, $tool_calls tool calls, $total_tokens tokens"

          # Validate expected tools were called
          tool_names=$(echo "$json" | jq -r '.data.toolCalls // [] | .[].name' 2>/dev/null)
          echo ""
          echo "--- Tool Call Sequence ---"
          echo "$tool_names" | nl
          echo ""

          for expected in create_project create_ticket; do
            echo "$tool_names" | grep -q "$expected" && log_success "Expected: $expected" || log_warn "Expected NOT called: $expected"
          done
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message // "Unknown"')"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
