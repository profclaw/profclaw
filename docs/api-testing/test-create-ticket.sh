#!/bin/bash
# =============================================================================
# Test: Create Ticket Flow
# =============================================================================
# Tests the ticket creation tool calling flow.
# This is a common failure point - the AI should call create_ticket tool.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

TICKET_TITLE="${1:-Test API Bug}"
TICKET_DESC="${2:-This is a test ticket created via API testing}"

echo "========================================"
echo "Test: Create Ticket Flow"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"

MESSAGE="Create a ticket titled '$TICKET_TITLE' with description: $TICKET_DESC"
log_info "Message: $MESSAGE"
echo ""

# Send message with tools enabled
log_info "Sending create ticket request..."
response=$(api_request "POST" "/chat/conversations/$CONV_ID/messages/with-tools" "{
  \"content\": \"$MESSAGE\",
  \"enableTools\": true,
  \"model\": \"$GLINR_MODEL\"
}")

# Check for error
if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
  log_error "Request failed:"
  echo "$response" | pretty_json
  exit 1
fi

# Display tool calls
tool_calls=$(echo "$response" | jq '.toolCalls // []')
tool_count=$(echo "$tool_calls" | jq 'length')

echo ""
echo "========================================"
echo "TOOL EXECUTION ANALYSIS"
echo "========================================"

if [ "$tool_count" -eq 0 ]; then
  log_error "NO TOOLS WERE CALLED!"
  echo ""
  echo "This is the bug - the AI should have called 'create_ticket' but didn't."
  echo ""
  echo "Possible causes:"
  echo "  1. System prompt doesn't enable tools properly"
  echo "  2. Model doesn't support tool calling"
  echo "  3. Tool definitions not passed to model"
  echo ""
else
  log_success "Tools called: $tool_count"
  echo ""

  # Analyze each tool call
  echo "$tool_calls" | jq -c '.[]' | while read -r tc; do
    name=$(echo "$tc" | jq -r '.name')
    status=$(echo "$tc" | jq -r '.status // "unknown"')
    args=$(echo "$tc" | jq '.arguments')

    if [ "$name" = "create_ticket" ]; then
      log_success "create_ticket was called!"
      echo "  Arguments:"
      echo "$args" | jq '.'
      echo "  Status: $status"

      if [ "$status" = "success" ]; then
        result=$(echo "$tc" | jq '.result')
        if [ "$result" != "null" ]; then
          echo "  Result:"
          echo "$result" | jq '.'
        fi
      elif [ "$status" = "error" ]; then
        log_error "Tool execution failed!"
        echo "$tc" | jq '.result'
      fi
    else
      log_warn "Called unexpected tool: $name"
      echo "  Arguments: $(echo "$args" | jq -c '.')"
      echo "  Status: $status"
    fi
    echo ""
  done
fi

echo ""
echo "========================================"
echo "ASSISTANT RESPONSE"
echo "========================================"
echo ""
echo "$response" | jq -r '.assistantMessage.content'
echo ""

# Show model info
echo "Model: $(echo "$response" | jq -r '.assistantMessage.model // "unknown"')"
echo "Provider: $(echo "$response" | jq -r '.assistantMessage.provider // "unknown"')"
echo ""

# Save full response for debugging
debug_file="${SCRIPT_DIR}/.last-create-ticket-response.json"
echo "$response" > "$debug_file"
log_info "Full response saved to: $debug_file"

echo ""
log_success "Test complete"
