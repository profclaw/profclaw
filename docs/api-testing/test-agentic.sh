#!/bin/bash
# =============================================================================
# Test: Agentic Mode (SSE Streaming)
# =============================================================================
# Tests the agentic mode which runs autonomously with tool calling.
# This endpoint streams SSE events showing real-time progress.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

MESSAGE="${1:-Create a ticket titled 'Test Bug' with high priority}"

echo "========================================"
echo "Test: Agentic Mode (SSE)"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Message: $MESSAGE"
echo ""

# Send agentic request and capture SSE stream
log_info "Starting agentic session (streaming)..."
echo ""
echo "========================================"
echo "SSE EVENT STREAM"
echo "========================================"
echo ""

# Use agentic_request helper (includes timeout)
agentic_request "$CONV_ID" "$MESSAGE" 10 | while read -r line; do
    # Parse SSE data lines
    if [[ "$line" == data:* ]]; then
      # Extract JSON after "data: "
      json="${line#data: }"

      # Skip empty data
      if [ -z "$json" ] || [ "$json" = "" ]; then
        continue
      fi

      # Parse event type
      event_type=$(echo "$json" | jq -r '.type // "unknown"' 2>/dev/null)

      case "$event_type" in
        "session:start")
          log_info "Session started"
          ;;
        "thinking:start"|"thinking:update")
          # Show thinking if enabled
          thinking=$(echo "$json" | jq -r '.data.content // ""')
          if [ -n "$thinking" ]; then
            echo -e "${YELLOW}[Thinking]${NC} ${thinking:0:100}..."
          fi
          ;;
        "step:start")
          step=$(echo "$json" | jq -r '.data.step // "?"')
          echo -e "${BLUE}[Step $step]${NC} Starting..."
          ;;
        "tool:call")
          tool_name=$(echo "$json" | jq -r '.data.name // "unknown"')
          tool_args=$(echo "$json" | jq -c '.data.arguments // {}')
          echo -e "${GREEN}[Tool Call]${NC} $tool_name"
          echo "  Args: ${tool_args:0:100}..."
          ;;
        "tool:result")
          tool_name=$(echo "$json" | jq -r '.data.name // "unknown"')
          status=$(echo "$json" | jq -r '.data.status // "unknown"')
          # Status values: pending, approved, denied, executed, failed
          if [ "$status" = "executed" ]; then
            echo -e "${GREEN}[Tool OK]${NC} $tool_name succeeded"
          elif [ "$status" = "failed" ]; then
            echo -e "${RED}[Tool Error]${NC} $tool_name failed"
            echo "$json" | jq -r '.data.error // ""'
          else
            echo -e "${YELLOW}[Tool]${NC} $tool_name ($status)"
          fi
          ;;
        "step:complete")
          step=$(echo "$json" | jq -r '.data.step // "?"')
          echo -e "${BLUE}[Step $step]${NC} Complete"
          ;;
        "summary")
          echo ""
          echo "========================================"
          echo "FINAL SUMMARY"
          echo "========================================"
          echo "$json" | jq -r '.data.summary // "No summary"'
          ;;
        "complete")
          echo ""
          log_success "Session complete"
          total_tokens=$(echo "$json" | jq -r '.data.totalTokens // "?"')
          total_steps=$(echo "$json" | jq -r '.data.totalSteps // "?"')
          echo "  Total tokens: $total_tokens"
          echo "  Total steps: $total_steps"
          ;;
        "error")
          log_error "Session error:"
          echo "$json" | jq -r '.data.message // "Unknown error"'
          ;;
        "user_message")
          log_info "User message received"
          ;;
        "message_saved")
          log_info "Message saved to conversation"
          ;;
        *)
          # Unknown event, show raw
          echo "[Event: $event_type] $json"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
