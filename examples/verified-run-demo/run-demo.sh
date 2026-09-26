#!/bin/sh
# Demo of `profclaw run` with a scripted stand-in agent (no model, no API key).
# Attempt 1 makes things worse and gets rolled back, attempt 2 fixes the bug.
# Needs a built profClaw (pnpm build) and git. Everything happens in a temp dir.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DEMO=$(mktemp -d)
echo "Demo dir: $DEMO"

mkdir "$DEMO/repo"
cd "$DEMO/repo"
git init -q -b main
git config user.email demo@example.com
git config user.name demo

cat > math.js <<'JS'
function add(a, b) { return a + b; }
function mul(a, b) { return a * b; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)) + 1; }
module.exports = { add, mul, clamp };
JS

cat > test.js <<'JS'
const { add, mul, clamp } = require('./math');
const cases = [
  ['add(2,3)=5', add(2, 3) === 5],
  ['mul(4,5)=20', mul(4, 5) === 20],
  ['clamp(15,0,10)=10', clamp(15, 0, 10) === 10],
];
let failed = 0;
for (const [name, ok] of cases) {
  if (!ok) { failed++; console.log('FAIL: ' + name); }
}
process.exit(failed === 0 ? 0 : 1);
JS

git add . && git commit -q -m "init"
echo "--- starting state"
node test.js || true

echo "--- profclaw run"
PROFCLAW_DEMO_STATE="$DEMO/attempt-count" \
  node "$ROOT/profclaw.mjs" run "Fix the failing clamp test" \
  --verify "node test.js" \
  --agent-cmd "$HERE/agent.sh" \
  --max-attempts 4 2>&1 | grep -vE 'WARN|INFO|punycode|trace-deprecation'

echo "--- evidence report"
cat .profclaw/runs/*/evidence.md
