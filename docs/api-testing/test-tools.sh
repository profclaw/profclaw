#!/bin/bash
# =============================================================================
# Test: Chat with Tools
# =============================================================================
# Tests tool calling functionality. Useful for debugging tool execution issues.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

MESSAGE="${1:-What files are in the src/routes directory?}"

echo "========================================"
echo "Test: Chat with Tools"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Message: $MESSAGE"
echo ""

# First, list available tools
log_info "Available tools:"
tools_response=$(api_request "GET" "/chat/tools")
echo "$tools_response" | jq -r '.tools[] | "  - \(.name)"' | head -20
echo "  ... ($(echo "$tools_response" | jq '.total') total)"
echo ""

# Send message with tools enabled
log_info "Sending message with tools enabled..."
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

# Display tool calls if any
tool_calls=$(echo "$response" | jq '.toolCalls // []')
tool_count=$(echo "$tool_calls" | jq 'length')

if [ "$tool_count" -gt 0 ]; then
  log_success "Tool calls made: $tool_count"
  echo ""
  echo "------- Tool Calls -------"
  echo "$tool_calls" | jq -r '.[] | "[\(.status // "unknown")] \(.name) -> \(.arguments | tostring | .[0:100])..."'
  echo "--------------------------"
  echo ""
else
  log_warn "No tool calls were made"
fi

# Extract and display response
log_success "Assistant Response:"
echo ""
echo "------- Response -------"
echo "$response" | jq -r '.assistantMessage.content'
echo "------------------------"
echo ""

# Show usage and model info
echo "Model: $(echo "$response" | jq -r '.assistantMessage.model // "unknown"')"
echo "Provider: $(echo "$response" | jq -r '.assistantMessage.provider // "unknown"')"

# Check for tool support warnings
tool_support=$(echo "$response" | jq '.toolSupport')
if [ "$tool_support" != "null" ]; then
  supported=$(echo "$tool_support" | jq -r '.supported')
  if [ "$supported" = "false" ]; then
    log_warn "Model may not fully support tools: $(echo "$tool_support" | jq -r '.message // "check compatibility"')"
  fi
fi

echo ""
log_success "Test complete"
