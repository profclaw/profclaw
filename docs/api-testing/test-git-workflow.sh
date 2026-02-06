#!/bin/bash
# =============================================================================
# Test: Git Workflow Multi-Step (Agentic)
# =============================================================================
# Tests: git_status -> git_log
# Validates git tools chain correctly in agentic mode.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "========================================"
echo "Test: Git Workflow Multi-Step"
echo "========================================"
echo ""

check_server || exit 1

CONV_ID=$(get_conversation_id) || exit 1
log_info "Using conversation: $CONV_ID"
log_info "Model: $GLINR_MODEL"

MESSAGE="Check the git status of the current project, then show me the last 3 commits from git log, and summarize what changed recently."

log_info "Prompt: git status + log chain"
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
          log_success "Tools used: $(echo "$tool_names" | tr '\n' ', ')"

          for expected in git_status git_log; do
            echo "$tool_names" | grep -q "$expected" && log_success "Expected: $expected" || log_warn "Missing: $expected"
          done
          ;;
        "error")
          log_error "$(echo "$json" | jq -r '.data.message')"
          ;;
      esac
    fi
  done

echo ""
log_success "Test complete"
