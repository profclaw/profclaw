# profClaw API Testing Status

Last Updated: 2026-02-05 19:30 CST

## Test Results Summary

### Architecture Change: SDK-Managed Multi-Step (v3)
Executor refactored from manual `while` loop (`maxSteps: 1` + manual message accumulation) to **AI SDK native multi-step** (`generateText` with `stopWhen` + `onStepFinish`). Tool chaining now handled entirely by the SDK.

### Quick Tests (Core)
| Test | Status | Notes |
|------|--------|-------|
| `test-simple-chat.sh` | PASS | Text-only response, proper AI summary |
| `test-tools.sh` | PASS | Tool calling endpoint works |
| `test-create-ticket.sh` | PASS | Single-step tool call |

### Agentic Multi-Step Tests
| Test | Status | Tools Used | Notes |
|------|--------|------------|-------|
| `test-agentic.sh` | PASS | list_projects, create_ticket | 3 steps, proper ticket link in summary |
| `test-project-ticket-flow.sh` | PASS | create_project, create_ticket, update_ticket, get_ticket | 4-tool CRUD chain, step-by-step summary |
| `test-git-workflow.sh` | PASS | git_status, git_log | Parallel in 1 step, detailed git state summary |
| `test-file-ops-chain.sh` | PASS | search_files, read_file, grep | 3-tool chain, file content summary |
| `test-error-recovery.sh` | PASS | read_file x2 | Failed on nonexistent file, recovered with real file |
| `test-cron-lifecycle.sh` | PASS | cron_create, cron_list, cron_trigger | Full lifecycle with IDs and timestamps in summary |
| `test-web-search.sh` | PASS | web_fetch, list_projects, create_ticket | 3-tool chain with ticket link |

### Full Suite (`./run-all.sh`)
| Mode | Passed | Failed | Warnings |
|------|--------|--------|----------|
| `--quick` | 3/3 | 0 | 0 |
| Full (sequential) | 10/10 | 0 | 0 |
| Full (`--parallel`) | 10/10 | 0 | 0 |

### Unit Tests
| Suite | Passed | Skipped | Total |
|-------|--------|---------|-------|
| Vitest | 442 | 5 | 447 |

## SDK Multi-Step Refactor (v3)

### What Changed
- **Removed**: Manual `while` loop, `executeStep()`, `processToolCalls()`, `injectContext()`, `buildStepContext()`, manual message accumulation, manual tool result formatting
- **Added**: `wrapToolsWithExecute()`, `onStepFinish` callback, `stopWhen: [stepCountIs(N), hasToolCall('complete_task')]`
- **Result**: ~150 lines deleted, ~40 lines added. SDK handles message format and result feeding internally.

### Key Improvements
- **Tool chaining works natively**: SDK feeds tool results back as properly formatted messages
- **Proper AI summaries**: Model generates contextual summaries (no more "Agent completed after N steps" fallbacks)
- **3-tier summary priority**: 1) `complete_task` tool summary, 2) AI's last text response, 3) descriptive fallback from tool history
- **Custom stop conditions via abort**: Consecutive failures, same tool repeated, timeout checked in `onStepFinish`

## Improvements Applied (v2)

### Performance
- **Parallel execution**: `./run-all.sh --parallel` runs all tests concurrently (~3x faster)
- **Timeout handling**: All curl calls have `--max-time` limits (30s API, 90s agentic, 120s per-test)
- **Per-test timing**: Results table shows duration for each test
- **Suite timing**: Total wall-clock time reported at end

### Reliability
- **`agentic_request()` helper**: Centralized SSE request function with built-in timeout
- **Test isolation**: `--isolated` flag creates fresh conversation per test (no state pollution)
- **Timeout detection**: Tests killed after timeout reported as TIMEOUT (exit code 124)
- **Cron test fixed**: Updated prompt to name tools explicitly (cron tools now available via `getAllChatTools()`)
- **Web search test fixed**: More explicit prompt enforces tool chaining

### Code Quality
- **Reduced duplication**: All agentic tests use `agentic_request()` helper from config.sh
- **Reusable SSE parser**: `parse_sse_stream()` and `check_expected_tools()` in config.sh
- **Timing helpers**: `now_ms()` and `format_duration()` (macOS compatible)
- **New CLI flags**: `--parallel`, `--isolated`, `--verbose`, `--timeout N`

## Key Findings

### Working Well
- Multi-step tool chains work correctly (project -> ticket -> update -> get)
- Parallel tool calls in single step (git_status + git_log)
- Error recovery: model retries with different approach after tool failure
- AI SDK v6 native multi-step with `stopWhen` + `onStepFinish`
- Cron tools accessible in agentic mode (getAllChatTools fix confirmed)
- Proper AI-generated summaries with ticket links, step details, and context

### Known Behaviors
- Model sometimes uses `web_fetch` instead of `web_search` (gpt4o-mini preference)
- Cron trigger may return "no job found" if job name doesn't match exactly

## Test Environment

- Server: `pnpm dev` running on localhost:3000
- Model: Azure GPT-4o (fallback from Anthropic - no ANTHROPIC_API_KEY set)
- `PROFCLAW_MODEL=gpt4o-mini` (default in config.sh)
- Conversation persistence: Working via `.test-state.json`

## Usage

```bash
# Quick smoke test (3 tests, ~10s)
./run-all.sh --quick

# Full sequential (10 tests, ~2-3 min)
./run-all.sh

# Full parallel (~40-60s)
./run-all.sh --parallel

# Parallel + isolated conversations
./run-all.sh --parallel --isolated

# Verbose sequential (see test output)
./run-all.sh --verbose

# Custom timeout
./run-all.sh --timeout 60
```

## Test Scripts

```
docs/api-testing/
├── config.sh                    # Shared config, helpers, timeouts, SSE parser
├── setup.sh                     # Create test conversation
├── run-all.sh                   # Master test runner (parallel, timing, timeouts)
├── test-simple-chat.sh          # Basic chat (core)
├── test-tools.sh                # Tool calling (core)
├── test-create-ticket.sh        # Single-step ticket creation (core)
├── test-agentic.sh              # Multi-step agentic (generic)
├── test-project-ticket-flow.sh  # Project + ticket CRUD chain
├── test-git-workflow.sh         # Git status + log
├── test-file-ops-chain.sh       # File search/read/grep
├── test-cron-lifecycle.sh       # Cron create/list/trigger
├── test-error-recovery.sh       # Deliberate failure + recovery
├── test-web-search.sh           # Web search + ticket creation
├── debug-tool-loop.sh           # Debug tool repetition issues
├── profclaw_test.py                # Python test framework
└── README.md                    # Documentation
```
