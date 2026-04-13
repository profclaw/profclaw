#!/bin/bash
# =============================================================================
# profClaw API Testing - Setup
# =============================================================================
# Creates a test conversation and stores the ID for use in other test scripts.
#
# Usage: ./setup.sh [--force]
#   --force  Create new conversation even if one exists

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# Parse args
FORCE_NEW=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --force) FORCE_NEW=true; shift ;;
    *) shift ;;
  esac
done

echo "========================================"
echo "profClaw API Testing Setup"
echo "========================================"
echo ""

# Check server
if ! check_server; then
  exit 1
fi

# Check for existing conversation
existing_id=$(get_state "conversationId")
if [ -n "$existing_id" ] && [ "$FORCE_NEW" = false ]; then
  log_info "Existing conversation found: $existing_id"

  # Verify it still exists
  response=$(api_request "GET" "/chat/conversations/$existing_id")
  if echo "$response" | jq -e '.conversation' > /dev/null 2>&1; then
    log_success "Conversation is valid and ready for testing"
    echo ""
    echo "Conversation ID: $existing_id"
    echo "Run with --force to create a new conversation"
    exit 0
  else
    log_warn "Conversation no longer exists, creating new one..."
  fi
fi

# Create new conversation
log_info "Creating test conversation..."

response=$(api_request "POST" "/chat/conversations" '{
  "title": "API Test Session",
  "presetId": "profclaw-assistant"
}')

# Extract conversation ID
conv_id=$(echo "$response" | jq -r '.conversation.id // empty')

if [ -z "$conv_id" ]; then
  log_error "Failed to create conversation"
  echo "$response" | pretty_json
  exit 1
fi

# Store in state
set_state "conversationId" "$conv_id"
set_state "createdAt" "$(date -Iseconds)"

log_success "Created conversation: $conv_id"

# Print summary
echo ""
echo "========================================"
echo "Setup Complete"
echo "========================================"
echo ""
echo "Conversation ID: $conv_id"
echo "State file: $PROFCLAW_STATE_FILE"
echo ""
echo "You can now run test scripts:"
echo "  ./test-simple-chat.sh    - Test basic chat"
echo "  ./test-tools.sh          - Test tool calling"
echo "  ./test-create-ticket.sh  - Test ticket creation flow"
echo "  ./test-agentic.sh        - Test agentic mode"
echo ""
