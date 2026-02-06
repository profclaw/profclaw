#!/bin/bash
# =============================================================================
# Run All API Tests
# =============================================================================
# Runs each test script with timing, timeouts, and optional parallelism.
#
# Usage: ./run-all.sh [options]
#   --quick       Skip slow multi-step tests (core only)
#   --parallel    Run independent tests in parallel (~3x faster)
#   --sequential  Force sequential execution (default)
#   --timeout N   Per-test timeout in seconds (default: 120)
#   --isolated    Create fresh conversation per test (no state pollution)
#   --verbose     Show test output in real-time (sequential only)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# =============================================================================
# Parse Arguments
# =============================================================================
QUICK=false
PARALLEL=false
VERBOSE=false
ISOLATED=false
PER_TEST_TIMEOUT="${TEST_TIMEOUT:-120}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --quick) QUICK=true; shift ;;
    --parallel) PARALLEL=true; shift ;;
    --sequential) PARALLEL=false; shift ;;
    --timeout) PER_TEST_TIMEOUT="$2"; shift 2 ;;
    --isolated) ISOLATED=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    *) shift ;;
  esac
done

# =============================================================================
# Setup
# =============================================================================
SUITE_START=$(now_ms)
RESULTS_DIR=$(mktemp -d)
trap 'rm -rf "$RESULTS_DIR"' EXIT

echo "========================================"
echo "GLINR API Test Suite"
echo "========================================"
echo "Model:    $GLINR_MODEL"
echo "Mode:     $([ "$PARALLEL" = true ] && echo "PARALLEL" || echo "SEQUENTIAL")"
echo "Timeout:  ${PER_TEST_TIMEOUT}s per test"
echo "Isolated: $([ "$ISOLATED" = true ] && echo "YES (fresh conversations)" || echo "NO (shared conversation)")"
echo "========================================"
echo ""

check_server || exit 1
echo ""

# Ensure we have a conversation for shared mode
if [ "$ISOLATED" = false ]; then
  get_conversation_id > /dev/null 2>&1 || {
    log_info "No conversation found. Running setup..."
    "${SCRIPT_DIR}/setup.sh" || exit 1
  }
fi

# =============================================================================
# Test Runner
# =============================================================================

# Run a single test with timeout and timing, writing result to RESULTS_DIR
run_test() {
  local name="$1"
  local script="$2"
  shift 2
  local result_file="${RESULTS_DIR}/$(echo "$name" | tr ' ' '_').result"
  local start end duration exit_code

  start=$(now_ms)

  # Set up isolated conversation if requested
  local extra_env=""
  if [ "$ISOLATED" = true ]; then
    local iso_conv
    iso_conv=$(create_test_conversation "Test: $name" 2>/dev/null)
    if [ -n "$iso_conv" ]; then
      extra_env="GLINR_CONV_OVERRIDE=$iso_conv"
    fi
  fi

  # Run with timeout (macOS compatible - use perl if no timeout command)
  local timeout_cmd="timeout"
  if ! command -v timeout &>/dev/null; then
    timeout_cmd="perl -e 'alarm shift; exec @ARGV' --"
  fi

  if [ "$VERBOSE" = true ] && [ "$PARALLEL" = false ]; then
    echo "----------------------------------------"
    echo "Running: $name"
    echo "----------------------------------------"
    if eval "$timeout_cmd ${PER_TEST_TIMEOUT} env $extra_env \"$script\" $* 2>&1"; then
      exit_code=0
    else
      exit_code=$?
    fi
  else
    if eval "$timeout_cmd ${PER_TEST_TIMEOUT} env $extra_env \"$script\" $* >/dev/null 2>&1"; then
      exit_code=0
    else
      exit_code=$?
    fi
  fi

  end=$(now_ms)
  duration=$(( end - start ))

  # Determine status
  local status
  if [ "$exit_code" -eq 0 ]; then
    status="PASS"
  elif [ "$exit_code" -eq 124 ]; then
    status="TIMEOUT"
  else
    status="FAIL"
  fi

  # Write result
  echo "${status}|${duration}|${name}" > "$result_file"

  # Print inline for sequential mode
  if [ "$PARALLEL" = false ]; then
    local dur_str
    dur_str=$(format_duration "$duration")
    case "$status" in
      PASS)    log_success "$name ${DIM}($dur_str)${NC}" ;;
      FAIL)    log_error "$name ${DIM}($dur_str)${NC}" ;;
      TIMEOUT) log_error "$name ${DIM}(TIMEOUT after ${PER_TEST_TIMEOUT}s)${NC}" ;;
    esac
  fi
}

# =============================================================================
# Define Test Groups
# =============================================================================

# Quick tests (core, fast)
declare -a QUICK_TESTS=(
  "Simple Chat|${SCRIPT_DIR}/test-simple-chat.sh|ping"
  "Tools Available|${SCRIPT_DIR}/test-tools.sh|What time is it?"
  "Create Ticket|${SCRIPT_DIR}/test-create-ticket.sh"
)

# Agentic tests (slower, multi-step)
declare -a AGENTIC_TESTS=(
  "Agentic: Ticket Flow|${SCRIPT_DIR}/test-agentic.sh|Create a ticket titled 'Run-All Test' with type bug"
  "Agentic: Git Workflow|${SCRIPT_DIR}/test-git-workflow.sh"
  "Agentic: File Ops Chain|${SCRIPT_DIR}/test-file-ops-chain.sh"
  "Agentic: Error Recovery|${SCRIPT_DIR}/test-error-recovery.sh"
  "Agentic: Cron Lifecycle|${SCRIPT_DIR}/test-cron-lifecycle.sh"
  "Agentic: Web Search|${SCRIPT_DIR}/test-web-search.sh"
  "Agentic: Project+Ticket|${SCRIPT_DIR}/test-project-ticket-flow.sh"
)

# =============================================================================
# Execute Tests
# =============================================================================

run_test_from_spec() {
  local spec="$1"
  local IFS='|'
  read -r name script args <<< "$spec"
  if [ -n "$args" ]; then
    run_test "$name" "$script" "$args"
  else
    run_test "$name" "$script"
  fi
}

run_parallel_group() {
  local group_name=$1
  local pids=()
  eval "local specs=(\"\${${group_name}[@]}\")"

  for spec in "${specs[@]}"; do
    run_test_from_spec "$spec" &
    pids+=($!)
  done

  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}

run_sequential_group() {
  local group_name=$1
  eval "local specs=(\"\${${group_name}[@]}\")"
  for spec in "${specs[@]}"; do
    run_test_from_spec "$spec"
  done
}

# --- Quick tests ---
echo -e "${CYAN}=== Core Tests ===${NC}"
if [ "$PARALLEL" = true ]; then
  run_parallel_group QUICK_TESTS
else
  run_sequential_group QUICK_TESTS
fi
echo ""

# --- Agentic tests ---
if [ "$QUICK" = false ]; then
  echo -e "${CYAN}=== Agentic Tests ===${NC}"
  if [ "$PARALLEL" = true ]; then
    run_parallel_group AGENTIC_TESTS
  else
    run_sequential_group AGENTIC_TESTS
  fi
  echo ""
fi

# =============================================================================
# Results Summary
# =============================================================================
SUITE_END=$(now_ms)
SUITE_DURATION=$(( SUITE_END - SUITE_START ))

PASSED=0
FAILED=0
TIMEOUTS=0
SKIPPED=0
TOTAL=0

echo ""
echo "========================================"
echo "RESULTS"
echo "========================================"
echo ""

# Collect and display results
printf "%-35s %-10s %s\n" "TEST" "STATUS" "TIME"
printf "%-35s %-10s %s\n" "---" "------" "----"

for result_file in "$RESULTS_DIR"/*.result; do
  [ -f "$result_file" ] || continue
  IFS='|' read -r status duration name < "$result_file"
  TOTAL=$((TOTAL + 1))
  dur_str=$(format_duration "$duration")

  case "$status" in
    PASS)
      PASSED=$((PASSED + 1))
      printf "%-35s ${GREEN}%-10s${NC} %s\n" "$name" "PASS" "$dur_str"
      ;;
    FAIL)
      FAILED=$((FAILED + 1))
      printf "%-35s ${RED}%-10s${NC} %s\n" "$name" "FAIL" "$dur_str"
      ;;
    TIMEOUT)
      TIMEOUTS=$((TIMEOUTS + 1))
      printf "%-35s ${RED}%-10s${NC} %s\n" "$name" "TIMEOUT" "${PER_TEST_TIMEOUT}s+"
      ;;
  esac
done

if [ "$QUICK" = true ]; then
  SKIPPED=${#AGENTIC_TESTS[@]}
fi

echo ""
echo "----------------------------------------"
printf "${GREEN}Passed:${NC}   %d/%d\n" "$PASSED" "$TOTAL"
[ "$FAILED" -gt 0 ] && printf "${RED}Failed:${NC}   %d\n" "$FAILED"
[ "$TIMEOUTS" -gt 0 ] && printf "${RED}Timeouts:${NC} %d\n" "$TIMEOUTS"
[ "$SKIPPED" -gt 0 ] && printf "${YELLOW}Skipped:${NC}  %d (use without --quick)\n" "$SKIPPED"
echo ""
echo "Suite time: $(format_duration "$SUITE_DURATION")"
echo "========================================"

exit $(( FAILED + TIMEOUTS ))
