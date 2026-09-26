#!/bin/sh
# Scripted stand-in for a model. Runs in the run's worktree; the prompt arrives on stdin.
# Attempt 1 breaks more than it fixes, attempt 2 makes the real fix.
STATE=${PROFCLAW_DEMO_STATE:?set by run-demo.sh}
n=$(cat "$STATE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$STATE"
cat > /dev/null

if [ "$n" = "1" ]; then
  cat > math.js <<'JS'
function add(a, b) { return a - b; }
function mul(a, b) { return a + b; }
function clamp(x, lo, hi) { return x; }
module.exports = { add, mul, clamp };
JS
else
  cat > math.js <<'JS'
function add(a, b) { return a + b; }
function mul(a, b) { return a * b; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
module.exports = { add, mul, clamp };
JS
fi
