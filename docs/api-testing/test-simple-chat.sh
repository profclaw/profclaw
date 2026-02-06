#!/bin/bash
# =============================================================================
# Test: Simple Chat (No Tools)
# =============================================================================
# Tests basic chat functionality without tool calling.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

MESSAGE="${1:-Hello! What can you help me with?}"

echo "========================================"
echo "Test: Simple Chat"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Message: $MESSAGE"
echo ""

# Send message
response=$(api_request "POST" "/chat/conversations/$CONV_ID/messages" "{
  \"content\": \"$MESSAGE\",
  \"model\": \"$GLINR_MODEL\"
}")

# Check for error
if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
  log_error "Request failed:"
  echo "$response" | pretty_json
  exit 1
fi

# Extract and display response
log_success "Response received:"
echo ""
echo "------- Assistant Response -------"
echo "$response" | jq -r '.assistantMessage.content'
echo "-----------------------------------"
echo ""

# Show usage
echo "Model: $(echo "$response" | jq -r '.assistantMessage.model // "unknown"')"
echo "Provider: $(echo "$response" | jq -r '.assistantMessage.provider // "unknown"')"

echo ""
log_success "Test complete"
