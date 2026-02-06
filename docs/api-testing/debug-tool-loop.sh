#!/bin/bash
# =============================================================================
# Debug: Tool Loop Issues
# =============================================================================
# Investigates why tool calls might not proceed to the next tool.
# Useful when the AI gets stuck on the first tool and never continues.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Debug: Tool Execution Loop"
echo "========================================"
echo ""

check_server || exit 1

# Create a fresh conversation for debugging
log_info "Creating fresh conversation for debugging..."
response=$(api_request "POST" "/chat/conversations" '{
  "title": "Debug Tool Loop"
}')
CONV_ID=$(echo "$response" | jq -r '.conversation.id')
log_success "Created: $CONV_ID"
echo ""

# Test message that should trigger multiple tool calls
MESSAGE="First list the files in src/routes, then create a ticket titled 'Found Routes' with a description of what you found."

log_info "Test message (should trigger 2+ tools):"
echo "  $MESSAGE"
echo ""

# Make the request with verbose output
log_info "Sending request..."
echo ""

response=$(api_request "POST" "/chat/conversations/$CONV_ID/messages/with-tools" "{
  \"content\": \"$MESSAGE\",
  \"enableTools\": true
}")

# Save full response
debug_file="${SCRIPT_DIR}/.debug-tool-loop.json"
echo "$response" > "$debug_file"
log_info "Full response saved to: $debug_file"
echo ""

# Analyze tool calls
echo "========================================"
echo "TOOL CALL ANALYSIS"
echo "========================================"
echo ""

tool_calls=$(echo "$response" | jq '.toolCalls // []')
tool_count=$(echo "$tool_calls" | jq 'length')

log_info "Total tool calls: $tool_count"
echo ""

if [ "$tool_count" -eq 0 ]; then
  log_error "NO TOOLS WERE CALLED"
  echo ""
  echo "Possible issues:"
  echo "  1. Model doesn't support tool calling"
  echo "  2. System prompt doesn't enable tools"
  echo "  3. Tool definitions not passed to model"
  echo ""
elif [ "$tool_count" -eq 1 ]; then
  log_warn "Only 1 tool was called (expected 2+)"
  echo ""
  echo "The message asked for TWO actions:"
  echo "  1. List files in src/routes"
  echo "  2. Create a ticket"
  echo ""
  echo "But only one tool was called. This could indicate:"
  echo "  1. Tool loop terminates too early"
  echo "  2. AI thinks task is complete after first tool"
  echo "  3. Max roundtrips limit hit (check maxToolRoundtrips)"
  echo ""
else
  log_success "Multiple tools called - loop appears to work"
fi

echo ""
echo "Tool calls (in order):"
echo "$tool_calls" | jq -r 'to_entries[] | "\(.key+1). [\(.value.status // "?")] \(.value.name)"'

echo ""
echo "========================================"
echo "TOOL CALL DETAILS"
echo "========================================"

echo "$tool_calls" | jq -c '.[]' | while read -r tc; do
  name=$(echo "$tc" | jq -r '.name')
  status=$(echo "$tc" | jq -r '.status // "unknown"')
  args=$(echo "$tc" | jq '.arguments')
  result=$(echo "$tc" | jq '.result')

  echo ""
  echo "--- $name ---"
  echo "Status: $status"
  echo "Arguments:"
  echo "$args" | jq '.' | sed 's/^/  /'

  if [ "$result" != "null" ]; then
    echo "Result preview:"
    echo "$result" | jq '.' | head -10 | sed 's/^/  /'
    result_lines=$(echo "$result" | jq '.' | wc -l)
    if [ "$result_lines" -gt 10 ]; then
      echo "  ... ($result_lines total lines)"
    fi
  fi
done

echo ""
echo "========================================"
echo "ASSISTANT RESPONSE"
echo "========================================"
echo ""
echo "$response" | jq -r '.assistantMessage.content' | head -30
response_lines=$(echo "$response" | jq -r '.assistantMessage.content' | wc -l)
if [ "$response_lines" -gt 30 ]; then
  echo "... (truncated, $response_lines total lines)"
fi

echo ""
echo "========================================"
echo "MODEL INFO"
echo "========================================"
echo "Model: $(echo "$response" | jq -r '.assistantMessage.model // "unknown"')"
echo "Provider: $(echo "$response" | jq -r '.assistantMessage.provider // "unknown"')"

# Check for tool support warnings
tool_support=$(echo "$response" | jq '.toolSupport')
if [ "$tool_support" != "null" ]; then
  echo ""
  echo "Tool Support Status:"
  echo "$tool_support" | jq '.'
fi

echo ""
log_success "Debug complete"
echo ""
echo "Next steps:"
echo "  1. Check $debug_file for full response"
echo "  2. Look at maxToolRoundtrips in chat.ts"
echo "  3. Check if AI response indicates it thinks task is complete"
echo "  4. Verify model supports multi-turn tool calling"
