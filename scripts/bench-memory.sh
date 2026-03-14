#!/usr/bin/env bash
# Memory benchmark for profClaw across deployment modes
# Usage: ./scripts/bench-memory.sh [pico|mini|pro|all]
#
# Measures RSS (Resident Set Size) at:
#   1. Server startup (idle)
#   2. After first HTTP request (routes loaded)
#   3. After 10 concurrent requests (under light load)

set -euo pipefail

PORT="${BENCH_PORT:-13579}"
MODES=("${1:-all}")
WAIT_BOOT=3        # seconds to wait for server boot
WAIT_SETTLE=2      # seconds to let GC settle after requests

if [[ "${MODES[0]}" == "all" ]]; then
  MODES=("pico" "mini" "pro")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[0;90m'
BOLD='\033[1m'
RESET='\033[0m'

get_rss_mb() {
  local pid=$1
  if [[ "$(uname)" == "Darwin" ]]; then
    # macOS: ps RSS is in KB
    ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.1f", $1/1024}'
  else
    # Linux: /proc/pid/status VmRSS in kB
    grep VmRSS "/proc/$pid/status" 2>/dev/null | awk '{printf "%.1f", $2/1024}'
  fi
}

get_heap_mb() {
  local response
  response=$(curl -sf "http://127.0.0.1:$PORT/health" 2>/dev/null || echo '{}')
  echo "$response" | node -e "
    const d = require('fs').readFileSync('/dev/stdin','utf8');
    try { const j = JSON.parse(d); console.log('ok'); } catch { console.log('fail'); }
  " 2>/dev/null || echo "fail"
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo ""
echo -e "${BOLD}profClaw Memory Benchmark${RESET}"
echo -e "${DIM}Node $(node -v) | $(uname -s) $(uname -m)${RESET}"
echo -e "${DIM}$(date -u '+%Y-%m-%d %H:%M:%S UTC')${RESET}"
echo ""
printf "%-6s  %10s  %10s  %10s\n" "Mode" "Boot (MB)" "1 Req (MB)" "10 Req (MB)"
printf "%-6s  %10s  %10s  %10s\n" "------" "----------" "----------" "-----------"

for mode in "${MODES[@]}"; do
  # Kill any leftover server on our port
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 0.5

  # Start server in background
  PROFCLAW_MODE="$mode" PORT="$PORT" node dist/server.js &>/dev/null &
  SERVER_PID=$!

  # Wait for boot
  sleep "$WAIT_BOOT"

  # Check if server is alive
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    printf "%-6s  %10s  %10s  %10s\n" "$mode" "FAILED" "-" "-"
    continue
  fi

  # Measurement 1: Idle after boot
  rss_boot=$(get_rss_mb "$SERVER_PID")

  # Measurement 2: After first request (triggers lazy route loading)
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || true
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || true
  curl -sf "http://127.0.0.1:$PORT/api/tasks" >/dev/null 2>&1 || true
  sleep "$WAIT_SETTLE"
  rss_1req=$(get_rss_mb "$SERVER_PID")

  # Measurement 3: After 10 concurrent requests
  for i in $(seq 1 10); do
    curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &
    curl -sf "http://127.0.0.1:$PORT/api/tasks" >/dev/null 2>&1 &
  done
  wait
  sleep "$WAIT_SETTLE"
  rss_10req=$(get_rss_mb "$SERVER_PID")

  # Color code: green if <100MB, cyan if <200MB, red if >200MB
  color_boot=$GREEN; [[ $(echo "$rss_boot > 100" | bc 2>/dev/null || echo 0) == 1 ]] && color_boot=$CYAN; [[ $(echo "$rss_boot > 200" | bc 2>/dev/null || echo 0) == 1 ]] && color_boot=$RED
  color_1req=$GREEN; [[ $(echo "$rss_1req > 100" | bc 2>/dev/null || echo 0) == 1 ]] && color_1req=$CYAN; [[ $(echo "$rss_1req > 200" | bc 2>/dev/null || echo 0) == 1 ]] && color_1req=$RED
  color_10req=$GREEN; [[ $(echo "$rss_10req > 100" | bc 2>/dev/null || echo 0) == 1 ]] && color_10req=$CYAN; [[ $(echo "$rss_10req > 200" | bc 2>/dev/null || echo 0) == 1 ]] && color_10req=$RED

  printf "%-6s  ${color_boot}%10s${RESET}  ${color_1req}%10s${RESET}  ${color_10req}%10s${RESET}\n" \
    "$mode" "${rss_boot} MB" "${rss_1req} MB" "${rss_10req} MB"

  # Stop server
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null || true
  unset SERVER_PID
  sleep 0.5
done

echo ""
echo -e "${DIM}Targets: pico <50MB | mini <150MB | pro <300MB${RESET}"
echo -e "${DIM}Colors: green <100MB | cyan <200MB | red >200MB${RESET}"
echo ""

# Also show Node.js base overhead for reference
echo -e "${DIM}Reference: Node.js empty process baseline${RESET}"
node -e "
  setTimeout(() => {
    const m = process.memoryUsage();
    const rss = (m.rss / 1024 / 1024).toFixed(1);
    const heap = (m.heapUsed / 1024 / 1024).toFixed(1);
    console.log('  Node.js bare: RSS=' + rss + 'MB, Heap=' + heap + 'MB');
    process.exit(0);
  }, 500);
"
