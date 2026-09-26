# Verified run demo

Shows `profclaw run`: give it a goal and a verify command, and it only reports success when the verify command passes.

This demo uses a scripted stand-in for the model (`agent.sh`), so it needs no API key and is fully repeatable. It shows the loop, not model quality.

## Run it

```bash
pnpm build
./examples/verified-run-demo/run-demo.sh
```

Everything happens in a temporary directory. Your working tree is not touched.

## What happens

1. The script creates a tiny repo where one of three tests fails (`clamp` returns a value that is one too high).
2. `profclaw run` measures the starting state first: 1 failing line.
3. It creates an isolated git worktree and runs the agent.
4. Attempt 1 breaks more than it fixes (3 failing lines). The loop sees it is worse than the starting state and rolls the worktree back.
5. Attempt 2 makes the real fix and the verify command passes.
6. It writes `.profclaw/runs/<id>/evidence.md` and leaves the branch `profclaw/run-<id>` ready for review. It never pushes and never opens a PR.

## Excerpt of the evidence report

```text
### Attempt 1: worse (rolled back)

Verifier: FAIL, exit 1

FAIL: add(2,3)=5
FAIL: mul(4,5)=20
FAIL: clamp(15,0,10)=10

### Attempt 2: verified

Verifier: PASS, exit 0

## Diff

-function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)) + 1; }
+function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
```

## With a real model

Drop `--agent-cmd` to use the built-in agent. It starts on the smart router's cheap pick and moves up a model tier after repeated verifier failures. Tokens, cache hit rate and cost are printed per attempt and stop the run when a budget is hit (`--max-cost`, `--max-tokens`).

Run only on repositories you trust. The agent's `bash` tool is pattern-screened, not sandboxed.
