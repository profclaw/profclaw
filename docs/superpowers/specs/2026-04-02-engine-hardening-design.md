# profClaw Engine Hardening & Enhancement Spec

> Make profClaw launch-ready: reliable first-install, robust engine, Claude Code-inspired patterns.

**Date:** 2026-04-02
**Status:** Draft
**Priority focus:** CLI experience + Agent execution reliability

---

## Problem Statement

profClaw has a powerful engine (882-line executor, 72 tools, 35 providers, 22 chat channels) but isn't launch-ready because:

1. **First install breaks silently** — no auto-migrations, no setup redirect, no provider validation
2. **Engine lacks resilience patterns** — no circuit breakers, no context compaction, no deferred tool loading
3. **No hook system** — users can't customize behavior without modifying core code
4. **Tool results can blow up context** — no size limits, no disk spillover
5. **Streaming is rigid** — `generateText()` return value, not consumable async generator

Users who `npm i -g profclaw && profclaw serve` must get a working experience in 60 seconds or they uninstall.

---

## Workstreams

### WS-1: First-Install Reliability (CRITICAL — blocks launch)

These are the "user runs profclaw for the first time" fixes. All are independent and can be parallelized.

#### 1.1 Auto-Migration on Startup
- **File:** `src/storage/index.ts`
- **Change:** After `initStorage()` connects, call `await storage.runMigrations()`
- **Fallback:** If migration fails, log error with exact SQL that failed, suggest `profclaw db:migrate --verbose`
- **Test:** `src/storage/tests/auto-migrate.test.ts` — test fresh DB gets schema, test already-migrated DB is no-op

#### 1.2 Provider Validation on Startup
- **File:** `src/server.ts` (after agent init block ~line 768)
- **Change:** After agent registry populates, check `registry.getActiveAdapters().length > 0`. If zero:
  - Log: "No AI providers configured. Run `profclaw setup` or set ANTHROPIC_API_KEY / OPENAI_API_KEY"
  - If `PROFCLAW_STRICT_MODE=true`, exit(1)
  - Otherwise, continue but set `server.degradedMode = true`
- **Test:** `src/server/tests/startup-validation.test.ts`

#### 1.3 First-Run Setup Redirect
- **File:** `src/server.ts` (GET `/` route)
- **Change:** If admin user count === 0, redirect to `/setup` instead of serving blank dashboard
- **File:** `src/cli/commands/serve.ts`
- **Change:** On first boot, print banner: "First run detected. Visit http://localhost:9100/setup to configure profClaw"
- **Test:** `src/e2e/first-run.test.ts`

#### 1.4 In-Memory Storage Warning
- **File:** `src/server.ts`
- **Change:** When storage falls back to in-memory:
  - Log warning banner every 60s (not 30s — less noisy)
  - Add `X-ProfClaw-Storage: ephemeral` header via Hono middleware
  - Show yellow banner in UI dashboard
- **Test:** Extend existing storage tests

#### 1.5 Port Conflict Handling
- **File:** `src/cli/commands/serve.ts`
- **Change:** Replace check-then-bind with bind-or-retry:
  - Try configured port
  - If EADDRINUSE, try port+1, port+2 (max 3 attempts)
  - Log which port was actually used
- **Test:** `src/cli/tests/port-conflict.test.ts`

---

### WS-2: Engine Resilience (HIGH — prevents runtime failures)

#### 2.1 Circuit Breaker for Tools
- **File:** `src/agents/executor.ts`
- **New file:** `src/agents/circuit-breaker.ts`
- **Design:**
  ```typescript
  interface CircuitBreaker {
    state: 'closed' | 'open' | 'half-open'
    failureCount: number
    lastFailureAt: number
    cooldownMs: number  // starts at 5s, doubles each trip, max 60s
  }

  class ToolCircuitBreaker {
    private breakers: Map<string, CircuitBreaker>

    canExecute(toolName: string): boolean
    recordSuccess(toolName: string): void
    recordFailure(toolName: string): void
    getStatus(): Map<string, CircuitBreaker>
  }
  ```
- **Integration:** In executor's tool execution block (~line 494), check `circuitBreaker.canExecute(toolName)` before calling tool. On failure, `recordFailure()`. On success, `recordSuccess()`.
- **Thresholds:** 3 failures in 2 minutes → open. Half-open after cooldown. 1 success in half-open → close.
- **Test:** `src/agents/tests/circuit-breaker.test.ts`

#### 2.2 Per-Step Timeout Enforcement
- **File:** `src/agents/executor.ts`
- **Change:** The config already has `stepTimeoutMs: 60000` but it's not used. Wrap each step's tool execution in `Promise.race([toolExec, timeout(config.stepTimeoutMs)])`.
- **Test:** Extend `executor.test.ts`

#### 2.3 Tool Result Size Management
- **File:** `src/agents/executor.ts`
- **New file:** `src/agents/result-store.ts`
- **Design:**
  ```typescript
  const MAX_INLINE_RESULT_SIZE = 50_000  // 50KB inline in context
  const MAX_RESULT_SIZE = 5_000_000       // 5MB total before truncation

  class ResultStore {
    store(toolCallId: string, result: unknown): StoredResult
    // If result > MAX_INLINE_RESULT_SIZE:
    //   1. Save full result to temp file
    //   2. Return summary + file path as inline result
    //   3. Provide retrieve() for tools that need the full data
    retrieve(toolCallId: string): unknown
    cleanup(): void  // called on session end
  }
  ```
- **Integration:** After tool returns result, pass through `resultStore.store()`. Agent sees summary; tools can access full data.
- **Test:** `src/agents/tests/result-store.test.ts`

---

### WS-3: Async Generator Streaming (HIGH — architectural upgrade)

This is the biggest change. Refactors the executor to yield events as they happen instead of returning a final result.

#### 3.1 Event Types
- **New file:** `src/agents/events.ts`
  ```typescript
  type AgentEvent =
    | { type: 'session:start'; sessionId: string; config: AgentConfig }
    | { type: 'step:start'; stepIndex: number }
    | { type: 'tool:call'; toolName: string; args: unknown; toolCallId: string }
    | { type: 'tool:result'; toolCallId: string; result: unknown; duration: number }
    | { type: 'tool:error'; toolCallId: string; error: string }
    | { type: 'content'; text: string; delta: string }
    | { type: 'thinking'; text: string }
    | { type: 'cost:update'; tokens: TokenUsage; estimatedCost: number }
    | { type: 'circuit:open'; toolName: string; cooldownMs: number }
    | { type: 'step:complete'; stepIndex: number; summary: StepSummary }
    | { type: 'session:complete'; result: AgentResult }
    | { type: 'session:error'; error: AgentError }
    | { type: 'session:abort'; reason: string }
  ```

#### 3.2 Generator Executor
- **File:** `src/agents/executor.ts`
- **Change:** Add `async *stream()` method alongside existing `run()`:
  ```typescript
  class AgentExecutor extends EventEmitter {
    // Existing — kept for backward compat
    async run(...): Promise<AgentState> {
      let lastResult: AgentResult | undefined
      for await (const event of this.stream(...)) {
        if (event.type === 'session:complete') lastResult = event.result
      }
      return this.buildState(lastResult)
    }

    // New — the real engine
    async *stream(
      model: LanguageModel,
      messages: ModelMessage[],
      tools: ToolSet,
      options?: StreamOptions
    ): AsyncGenerator<AgentEvent> {
      yield { type: 'session:start', ... }
      // ... existing logic refactored to yield events
    }
  }
  ```
- **Key:** `run()` wraps `stream()`, so all existing callers work unchanged. New callers (CLI TUI, SSE, SDK) consume the generator directly.
- **Test:** `src/agents/tests/streaming.test.ts`

#### 3.3 SSE Integration
- **File:** `src/server.ts` (SSE endpoint)
- **Change:** Replace manual event broadcasting with direct generator consumption:
  ```typescript
  // On new task/chat request:
  const stream = executor.stream(model, messages, tools)
  for await (const event of stream) {
    broadcastSSE(event)
  }
  ```

---

### WS-4: Hook System (MEDIUM-HIGH — extensibility)

#### 4.1 Hook Registry
- **New file:** `src/hooks/registry.ts`
  ```typescript
  type HookPoint =
    | 'beforeToolCall'
    | 'afterToolCall'
    | 'beforeApiCall'
    | 'afterResponse'
    | 'onSessionStart'
    | 'onSessionEnd'
    | 'onError'
    | 'onBudgetWarning'

  interface Hook {
    name: string
    point: HookPoint
    priority: number  // lower runs first
    handler: (context: HookContext) => Promise<HookResult>
  }

  interface HookResult {
    proceed: boolean      // false = abort the operation
    modified?: unknown    // override args/result if provided
    metadata?: Record<string, unknown>
  }

  class HookRegistry {
    register(hook: Hook): void
    unregister(name: string): void
    run(point: HookPoint, context: HookContext): Promise<HookResult>
  }
  ```

#### 4.2 Built-in Hooks
- **Cost warning hook:** Fires at 50%, 80%, 100% budget usage
- **Dangerous tool hook:** Prompts for confirmation on file writes, bash commands
- **Logging hook:** Records all tool calls to audit log

#### 4.3 Integration Points
- `src/agents/executor.ts` — wrap tool calls with `hooks.run('beforeToolCall')` / `hooks.run('afterToolCall')`
- `src/server.ts` — load hooks from `profclaw.hooks.yml` or `hooks/` directory on startup
- **Test:** `src/hooks/tests/registry.test.ts`

---

### WS-5: Deferred Tool Loading (MEDIUM — performance + context savings)

#### 5.1 Tool Categories
- **File:** `src/chat/execution/tools/` (existing tool definitions)
- **New file:** `src/agents/tool-loader.ts`
- **Design:** Categorize 72 tools into groups:
  ```
  always_loaded (10-15 core tools):
    - read_file, write_file, search_files
    - bash, git_status, git_commit
    - complete_task, create_ticket

  deferred (remaining 55+ tools):
    - browser_* (7 tools) — loaded when task mentions URLs/web
    - integration_* (12 tools) — loaded when task mentions Slack/GitHub/etc
    - canvas_* (5 tools) — loaded when task mentions diagrams/visuals
    - voice_* (3 tools) — loaded when task mentions audio/voice
    - ...
  ```

#### 5.2 Tool Search Tool
- **New file:** `src/chat/execution/tools/tool-search.ts`
  ```typescript
  // Added to always_loaded set
  const toolSearchTool = {
    name: 'search_available_tools',
    description: 'Search for additional tools by capability. Returns matching tools that can be used.',
    parameters: { query: z.string().describe('What capability you need') },
    execute: async ({ query }) => {
      const matches = toolLoader.search(query)
      // Dynamically add matched tools to current session
      return { tools: matches.map(t => ({ name: t.name, description: t.description })) }
    }
  }
  ```
- **Test:** `src/agents/tests/tool-loader.test.ts`

---

### WS-6: Context Compaction (MEDIUM — prevents context overflow)

#### 6.1 History Compactor
- **New file:** `src/agents/context-compactor.ts`
  ```typescript
  interface CompactionConfig {
    maxContextTokens: number        // default: model's context - 20% headroom
    compactionThreshold: number     // trigger at 70% of max
    preserveRecentTurns: number     // always keep last 5 turns verbatim
    summaryModel: string            // use cheap model for summarization
  }

  class ContextCompactor {
    async compact(messages: Message[], config: CompactionConfig): Promise<Message[]> {
      const tokenCount = estimateTokens(messages)
      if (tokenCount < config.compactionThreshold) return messages

      // Split: [older messages] | [recent N turns]
      // Summarize older messages into single system-context message
      // Return: [summary] + [recent turns]
    }
  }
  ```

#### 6.2 Integration
- **File:** `src/agents/executor.ts` — before each API call, run `compactor.compact(messages)`
- **File:** `src/chat/agentic-executor.ts` — same integration for chat executor
- **Test:** `src/agents/tests/context-compactor.test.ts`

---

## Parallelization Strategy

These workstreams have minimal dependencies:

```
Independent (can run in parallel):
├── WS-1.1  Auto-migration         (storage layer)
├── WS-1.2  Provider validation    (server startup)
├── WS-1.3  First-run redirect     (server routes)
├── WS-1.4  In-memory warning      (server middleware)
├── WS-1.5  Port conflict          (CLI serve command)
├── WS-2.1  Circuit breaker        (new file + executor integration)
├── WS-2.2  Step timeout           (executor only)
├── WS-4.1  Hook registry          (new file, standalone)
├── WS-5.1  Tool categorization    (new file, standalone)
├── WS-6.1  Context compactor      (new file, standalone)
└── WS-4.2  Built-in hooks         (depends on WS-4.1)

Sequential (depends on prior work):
WS-2.3  Result store        → needs to exist before WS-3
WS-3.1  Event types         → first
WS-3.2  Generator executor  → depends on 3.1, 2.1, 2.2, 2.3
WS-3.3  SSE integration     → depends on 3.2
WS-4.3  Hook integration    → depends on 4.1 + 3.2
WS-5.2  Tool search tool    → depends on 5.1
WS-6.2  Compactor integration → depends on 6.1 + 3.2
```

## Agent Dispatch Plan

**Batch 1 — All parallel (no dependencies):**
| Agent | Workstream | Files touched |
|-------|-----------|---------------|
| Agent A | WS-1.1 Auto-migration | `src/storage/index.ts` + test |
| Agent B | WS-1.2 + 1.3 + 1.4 Provider validation + first-run + memory warning | `src/server.ts` + tests |
| Agent C | WS-1.5 Port conflict | `src/cli/commands/serve.ts` + test |
| Agent D | WS-2.1 Circuit breaker | New `src/agents/circuit-breaker.ts` + test |
| Agent E | WS-2.2 Step timeout | `src/agents/executor.ts` (small change) |
| Agent F | WS-2.3 Result store | New `src/agents/result-store.ts` + test |
| Agent G | WS-4.1 + 4.2 Hook registry + built-ins | New `src/hooks/` + tests |
| Agent H | WS-5.1 Tool categorization + 5.2 search tool | New `src/agents/tool-loader.ts` + tool |
| Agent I | WS-6.1 Context compactor | New `src/agents/context-compactor.ts` + test |

**Batch 2 — Sequential (after batch 1):**
| Agent | Workstream | Depends on |
|-------|-----------|-----------|
| Agent J | WS-3.1 + 3.2 Event types + Generator refactor | Batch 1 (D, E, F) |
| Agent K | WS-3.3 SSE integration | Agent J |
| Agent L | WS-4.3 Hook integration into executor | Agent J + G |
| Agent M | WS-6.2 Compactor integration | Agent J + I |

**Batch 3 — Final verification:**
| Agent | Task |
|-------|------|
| Agent N | Run full test suite, fix any integration issues |
| Agent O | First-install smoke test (fresh DB, no config, verify setup flow) |

---

## Testing Requirements

Every workstream produces tests. Minimum coverage:

| Workstream | Test type | Min test count |
|-----------|-----------|---------------|
| WS-1.x | Integration | 8 tests (2 per sub-item) |
| WS-2.1 | Unit | 6 tests (closed/open/half-open states, reset, concurrent) |
| WS-2.2 | Unit | 3 tests (timeout fires, timeout doesn't fire, cleanup) |
| WS-2.3 | Unit | 5 tests (inline, spillover, retrieve, cleanup, size edge cases) |
| WS-3.x | Unit + Integration | 8 tests (event ordering, backpressure, error propagation, SSE) |
| WS-4.x | Unit | 6 tests (register, priority, abort, modify, lifecycle) |
| WS-5.x | Unit | 4 tests (categorize, search, dynamic add, always-loaded) |
| WS-6.x | Unit | 4 tests (below threshold no-op, compaction, preserve recent, token estimate) |

**Total: ~44 new tests minimum**

---

## Success Criteria

After all workstreams complete:

1. `npm i -g profclaw && profclaw serve` on a fresh machine → setup wizard appears (not blank screen)
2. No AI keys configured → clear error message with instructions (not silent failure)
3. Tool fails 3 times → circuit breaker opens, agent tries alternative approach
4. 200KB tool result → stored on disk, summary in context
5. 50+ turn conversation → context auto-compacts, no token overflow crash
6. Agent executor yields typed events → CLI/SSE/SDK can all consume same stream
7. Users can add hooks via `profclaw.hooks.yml` without modifying core code
8. Agent only sees ~15 tools initially, discovers more via search tool
9. All 95 existing tests still pass
10. 44+ new tests added and passing

---

## Non-Goals

- UI redesign (separate effort)
- New chat channel integrations
- New tool implementations
- Provider SDK upgrades
- Performance benchmarking (do after launch)
