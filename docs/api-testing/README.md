# GLINR API Testing Framework

Scripts and tools for testing the GLINR chat API endpoints with real agent interactions.

## Quick Start

```bash
# 1. Start the server (in another terminal)
pnpm dev

# 2. Make scripts executable
chmod +x *.sh

# 3. Setup (creates a test conversation)
./setup.sh

# 4. Run all tests
./run-all.sh              # Sequential (~2-3 min)
./run-all.sh --quick      # Core tests only (~10s)
./run-all.sh --parallel   # All tests in parallel (~40-60s)
```

## Test Runner Options

```bash
./run-all.sh [options]
  --quick       Skip slow multi-step tests (core only)
  --parallel    Run independent tests in parallel (~3x faster)
  --sequential  Force sequential execution (default)
  --timeout N   Per-test timeout in seconds (default: 120)
  --isolated    Create fresh conversation per test (no state pollution)
  --verbose     Show test output in real-time (sequential only)
```

**Example output:**

```
TEST                                STATUS     TIME
---                                 ------     ----
Simple Chat                         PASS       2.1s
Tools Available                     PASS       3.4s
Create Ticket                       PASS       4.2s
Agentic: Ticket Flow                PASS       12.8s
Agentic: Git Workflow               PASS       8.1s
...
Passed:   10/10
Suite time: 42.3s
```

## Scripts

### Core Tests (Fast)
| Script | Description | ~Time |
|--------|-------------|-------|
| `test-simple-chat.sh` | Basic chat without tools | 2s |
| `test-tools.sh` | Chat with tool calling | 3s |
| `test-create-ticket.sh` | Single-step ticket creation | 4s |

### Agentic Tests (Multi-Step)
| Script | Tools Tested | ~Time |
|--------|-------------|-------|
| `test-agentic.sh` | create_ticket, list_projects | 12s |
| `test-project-ticket-flow.sh` | create_project, create_ticket, update_ticket, get_ticket | 15s |
| `test-git-workflow.sh` | git_status, git_log | 8s |
| `test-file-ops-chain.sh` | search_files, read_file, grep | 10s |
| `test-error-recovery.sh` | read_file (fail + retry) | 10s |
| `test-cron-lifecycle.sh` | cron_create, cron_list, cron_trigger | 12s |
| `test-web-search.sh` | web_search/web_fetch, create_ticket | 15s |

### Infrastructure
| Script | Description |
|--------|-------------|
| `config.sh` | Shared config, helpers, timeouts, SSE parser |
| `setup.sh` | Creates test conversation and stores ID |
| `run-all.sh` | Master test runner with parallel/timing/timeout |
| `debug-tool-loop.sh` | Debug tool repetition issues |
| `glinr_test.py` | Python test framework |

## Configuration

### Environment Variables

```bash
export GLINR_BASE_URL="http://localhost:3000"    # Server URL
export GLINR_MODEL="gpt4o-mini"                   # Model alias

# Timeouts (seconds)
export CURL_TIMEOUT=30        # Simple API requests
export AGENTIC_TIMEOUT=90     # Agentic SSE streaming
export TEST_TIMEOUT=120       # Per-test timeout in run-all.sh
```

### Model Options
```bash
export GLINR_MODEL="gpt4o-mini"  # Azure GPT-4o Mini (default, fast)
export GLINR_MODEL="gpt4o"       # Azure GPT-4o (more capable)
export GLINR_MODEL="sonnet"      # Anthropic Claude (requires ANTHROPIC_API_KEY)
export GLINR_MODEL="groq"        # Groq (requires GROQ_API_KEY)
```

### State File

The `.test-state.json` stores the current conversation ID. Delete to reset: `rm .test-state.json`

## Helpers Available in config.sh

| Function | Description |
|----------|-------------|
| `api_request METHOD ENDPOINT [DATA]` | HTTP request with timeout |
| `agentic_request CONV_ID MESSAGE [MAX_STEPS]` | SSE agentic request with timeout |
| `create_test_conversation [TITLE]` | Create isolated conversation |
| `parse_sse_stream` | Pipe SSE output through for parsing |
| `check_expected_tools FILE tool1 tool2...` | Verify tools were called |
| `now_ms` / `format_duration MS` | Timing helpers (macOS compatible) |
| `check_server` | Verify server is running |
| `get_conversation_id` | Get stored conversation ID |

## Adding New Tests

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

check_server || exit 1
CONV_ID=$(get_conversation_id) || exit 1

# For simple API tests:
response=$(api_request "POST" "/chat/conversations/$CONV_ID/messages" '{
  "content": "Your test message", "model": "'$GLINR_MODEL'"
}')
echo "$response" | pretty_json

# For agentic tests with SSE:
agentic_request "$CONV_ID" "Your agentic prompt here" 10 | parse_sse_stream
check_expected_tools "$GLINR_TOOLS_FILE" expected_tool_1 expected_tool_2
```

## API Endpoints Tested

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/conversations` | POST | Create conversation |
| `/api/chat/conversations/:id` | GET | Get conversation |
| `/api/chat/conversations/:id/messages` | POST | Send message (no tools) |
| `/api/chat/conversations/:id/messages/with-tools` | POST | Send message (with tools) |
| `/api/chat/conversations/:id/messages/agentic` | POST | Agentic mode (SSE) |
| `/api/chat/tools` | GET | List available tools |

## Common Issues

### Tests Hanging
Tests now have built-in timeouts. If a test hangs, it will be killed after `TEST_TIMEOUT` seconds (default 120) and reported as TIMEOUT.

### Tools Not Being Called
If `test-create-ticket.sh` shows "NO TOOLS WERE CALLED":
1. Check model compatibility: `curl http://localhost:3000/api/chat/tools | jq`
2. Check model being used: `curl http://localhost:3000/api/chat/models | jq`
3. Verify agentic endpoint uses `getAllChatTools()` (not restricted set)

### State Pollution Between Tests
Use `./run-all.sh --isolated` to create a fresh conversation for each test. This prevents earlier test outputs from influencing later tests.
